from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.core.auto_dan_turbo import AutoDANTurbo


def _attack(score=5.0):
    return SimpleNamespace(
        score=score,
        attack_prompt="attack prompt",
        target_response="target response",
        strategies_used=[],
        iteration_number=1,
    )


def _turbo():
    turbo = AutoDANTurbo.__new__(AutoDANTurbo)
    turbo.config = {
        "attack": {
            "max_iterations_warmup": 1,
            "max_iterations_lifelong": 2,
            "max_summarization_iterations": 1,
            "termination_score": 8.5,
        }
    }
    turbo.attacker_generator = Mock()
    turbo.strategy_library = Mock()
    turbo.strategy_discoverer = Mock()
    turbo.strategy_validator = Mock()
    turbo.on_strategy_discovered = None
    turbo.on_request_completed = None
    turbo.current_phase = "not_started"
    turbo.total_attacks = 0
    turbo.successful_attacks = 0
    turbo.strategies_discovered = 0
    turbo.attack_logs = {}
    return turbo


@pytest.mark.parametrize("generated_attack", [None, _attack()])
def test_warmup_skips_discovery_without_two_scored_attacks(generated_attack):
    turbo = _turbo()
    turbo.attacker_generator.generate_initial_attack.return_value = generated_attack

    result = turbo.warmup_exploration(["request"])

    assert result["total_attacks"] == (1 if generated_attack else 0)
    turbo.strategy_discoverer.discover_strategy_from_improvement.assert_not_called()


def test_lifelong_retries_initial_attack_after_none():
    turbo = _turbo()
    turbo.attacker_generator.generate_initial_attack.side_effect = [None, _attack()]

    result = turbo.lifelong_learning(["request"])

    assert result["total_attacks"] == 1
    assert turbo.attacker_generator.generate_initial_attack.call_count == 2
    turbo.attacker_generator.generate_strategy_guided_attack.assert_not_called()


def test_evaluate_retries_initial_attack_after_none(tmp_path):
    turbo = _turbo()
    turbo.attacker_generator.generate_initial_attack.side_effect = [None, _attack(None)]

    result = turbo.evaluate(["request"], num_steps=1, save_dir=str(tmp_path))

    generations = next(iter(result.values()))
    assert len(generations) == 1
    assert generations[0]["target_response"] == "target response"
    assert turbo.attacker_generator.generate_initial_attack.call_count == 2
    turbo.attacker_generator.generate_strategy_guided_attack.assert_not_called()
