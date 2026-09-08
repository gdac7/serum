"""The background job that executes one AutoDAN-Turbo run.

Separate from the router so the request handler stays a thin validation +
enqueue step, and so the GPU-bound work has no FastAPI imports.
"""
from typing import Any, Dict, List

from server.approaches.autodan.strategy_repository import StrategyRepository
from server.db.run_repository import RunRepository
from server.state import build_target, gpu_lock, state, targets
from src.approaches.autodan.auto_dan_turbo import AutoDANTurbo
from src.harmbench_eval.get_harmbench_values import get_results, release_classifier


def _make_strategy_sink(run_id: str, library_id: str):
    """Persist each validated strategy on its own short-lived connection.

    A failed write is recorded on the run before being re-raised: the phase
    survives it, but the run must never look clean while dropping strategies.
    """
    pool = state.db_pool

    def sink(strategy) -> None:
        try:
            with pool.connection() as conn:
                StrategyRepository(conn).save_strategy(library_id, strategy)
        except Exception as e:
            with pool.connection() as conn:
                RunRepository(conn).append_persist_error(
                    run_id, f"{strategy.name}: {type(e).__name__}: {e}"
                )
            raise

    return sink


def _make_request_score_sink(run_id: str):
    """Record each finished malicious request's score summary on the run."""
    pool = state.db_pool

    def sink(entry) -> None:
        with pool.connection() as conn:
            RunRepository(conn).append_request_score(run_id, entry)

    return sink


def _set_status(run_id: str, status: str) -> None:
    with state.db_pool.connection() as conn:
        RunRepository(conn).set_status(run_id, status)


def run_autodan_task(run_id: str, target_id: str, dataset: List[str], phases: List[str], iteration_overrides: Dict[str, Any], library_id: str, fresh_library: bool = False):
    with gpu_lock:
        registry = state.registry
        autodan = shared_model = None
        try:
            target_info = targets.get(target_id)
            if not target_info or "config" not in target_info:
                raise ValueError(f"target '{target_id}' does not exist")
            if target_info.get("status") != "loaded" or "model_instance" not in target_info:
                # Weights aren't resident (e.g. registered before a restart).
                # We hold gpu_lock, so rebuilding here stays serialized.
                build_target(target_id)

            shared_model = registry.get("shared")
            autodan = AutoDANTurbo(
                attacker_model=shared_model,
                summarizer_model=shared_model,
                scorer_model=registry.get("scorer"),
                target_model=target_info["model_instance"],
                config=state.config,
                on_strategy_discovered=_make_strategy_sink(run_id, library_id),
                on_request_completed=_make_request_score_sink(run_id),
            )

            with state.db_pool.connection() as conn:
                repo = StrategyRepository(conn)
                at_start = repo.count_strategies(library_id)
                loaded = 0 if fresh_library else repo.hydrate(library_id, autodan.strategy_library)
                RunRepository(conn).set_progress(run_id, at_start, loaded)

            overrides = dict(iteration_overrides or {})
            num_steps = overrides.pop("num_steps", 4)
            save_dir = f"{run_id}/results"

            phase_summaries: Dict[str, Any] = {}
            generations = None
            for phase in phases:
                if phase == "warmup":
                    _set_status(run_id, "warmup")
                    phase_summaries[phase] = autodan.warmup_exploration(
                        malicious_request=dataset,
                        save_dir=save_dir,
                        **overrides,
                    )
                elif phase == "lifelong":
                    _set_status(run_id, "lifelong")
                    phase_summaries[phase] = autodan.lifelong_learning(
                        malicious_request=dataset,
                        save_dir=save_dir,
                        **overrides,
                    )
                elif phase == "evaluate":
                    _set_status(run_id, "evaluating")
                    generations = autodan.evaluate(
                        behavior=dataset,
                        num_steps=num_steps,
                        save_dir=save_dir,
                    )

            # Capture the per-attempt training logs before dropping the pipeline;
            # keyed by the phase name Node consumes, not the internal log key.
            training_logs: Dict[str, Any] = {}
            for out_key, log_key in (("warmup", "warmup"), ("lifelong", "lifelong_learning")):
                logs = autodan.attack_logs.get(log_key)
                if logs:
                    training_logs[out_key] = [log.to_dict() for log in logs]

            # Free attacker/scorer before the HarmBench classifier loads, so the two
            # never occupy the GPU at the same time.
            autodan = shared_model = None
            registry.release("shared", "scorer")

            metrics = None
            if generations is not None:
                _set_status(run_id, "scoring")
                try:
                    metrics = get_results(
                        generations, f"{save_dir}/harmbench_metrics.json"
                    )
                finally:
                    release_classifier()

            with state.db_pool.connection() as conn:
                RunRepository(conn).complete(run_id, {
                    "phases": phase_summaries,
                    "generations": generations,
                    "metrics": metrics,
                    "attack_logs": training_logs,
                })
        except Exception as e:
            with state.db_pool.connection() as conn:
                RunRepository(conn).fail(run_id, f"{type(e).__name__}: {e}")
        finally:
            # Rebind before releasing: a live local reference keeps the weights allocated.
            autodan = shared_model = None
            registry.release("shared", "scorer")

