import uuid
import json
from datetime import datetime, timezone
from typing import Callable, List, Optional, Dict, Any, Tuple
from dataclasses import dataclass
from .data_structures import AttackLog, JailbreakStrategy, StrategyLibrary, EmbeddingManager
from ..utils.dev import (
    debug_discovery_method_called,
    debug_no_improvement,
    debug_improvement_detected,
    debug_improvement_below_threshold,
    debug_strategy_extraction_attempt,
    debug_strategy_extracted,
    debug_strategy_novel,
    debug_no_strategy_extracted,
    debug_extraction_exception
)
from .prompts import PromptManager
import re
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

class StrategyDiscoverer:
    """
    Discover new jailbreak strategies by analyzing atatck logs.
    """
    def __init__(self, summarizer_model, embedding_manager: EmbeddingManager, strategy_library: StrategyLibrary, on_strategy_merged: Optional[Callable[[JailbreakStrategy], None]] = None):
        self.summarizer_model = summarizer_model
        self.embedding_manager = embedding_manager
        self.strategy_library = strategy_library
        self.prompt_manager = PromptManager()
        self.vectorizer = TfidfVectorizer()
        # Called with an existing strategy whose stats a rediscovery just
        # updated. AutoDANTurbo passes its own guarded sink emitter.
        self.on_strategy_merged = on_strategy_merged


    def discover_strategy_from_improvement(self, malicious_request: str, previous_attack: AttackLog, current_attack: AttackLog, threshold: float = 1.0) -> Optional[JailbreakStrategy]:
        """
        Discover strategy from a single improvement during lifelong.
        Used when we see an improvement in real-time and want immediately 
        extract the successful pattern.
        """
        debug_discovery_method_called(previous_attack.score, current_attack.score, threshold)
        
        if current_attack.score <= previous_attack.score:
            debug_no_improvement()
            return None
        
        improvement = current_attack.score - previous_attack.score
        debug_improvement_detected(improvement)
        
        if improvement < threshold:
            debug_improvement_below_threshold(improvement, threshold)
            return None
            
        try:
            debug_strategy_extraction_attempt()
            strategy = self._extract_strategy_from_pair(
                malicious_request,
                previous_attack, 
                current_attack, 
                improvement,
            )
            
            if strategy:
                debug_strategy_extracted(strategy.name, strategy.parent_strategies)
                if self._is_novel_strategy(strategy):
                    debug_strategy_novel(True)
                    print(f"Real-time strategy discovery: {strategy.name} (+{improvement:.1f})")
                    return strategy
                else:
                    debug_strategy_novel(False)
            else:
                debug_no_strategy_extracted()
                
        except Exception as e:
            debug_extraction_exception(str(e))

        return None
    
    def _extract_strategy_from_pair(self, malicious_request: str, weaker_attack: AttackLog, stronger_attack: AttackLog, improvement: float) -> Optional[JailbreakStrategy]:
        """
        Use the summarizer LLM to analyze why one attack was more successful.
        """
       
        prompt_template = self.prompt_manager.get_prompt(
            "extract_strategy",
            malicious_request=malicious_request,
            stronger_attack=stronger_attack,
            weaker_attack=weaker_attack,
            strategies_discovered=self.strategy_library.list_strategies(),
        )

        analysis_response = self.summarizer_model.generate(
            user_prompt=prompt_template.user_prompt, 
            system_prompt=prompt_template.system_prompt, 
            condition=prompt_template.condition,
            temperature=prompt_template.temperature,
            max_tokens=prompt_template.max_tokens,
            function="summarizer",
        )

        # Parse the response into a strategy
        strategy = self._parse_strategy_response(
            analysis_response, stronger_attack, weaker_attack, improvement
        )
        return strategy


    
    
    def _parse_strategy_response(self, response: str, stronger_attack: AttackLog, weaker_attack: AttackLog, improvement: float) -> Optional[JailbreakStrategy]:
        json_start = response.find('{')
        json_end = response.rfind('}') + 1
        if json_start == -1 or json_end == 0:
            return None
        json_str = response[json_start:json_end]
        json_str = re.sub(r",\s*([}\]])", r"\1", json_str)

        try:
            analysis = json.loads(json_str)
            required_fields = ["Strategy", "Definition"]
            if not all(field in analysis for field in required_fields):
                print(f"Missing required fields in analysis: {analysis}")
                return None
            strategy_id = str(uuid.uuid4())
            context_embedding = self.embedding_manager.encode_text(weaker_attack.target_response)

            # Collect parent strategies from both attacks
            parent_strategies = []
            if weaker_attack.strategies_used:
                parent_strategies.extend(weaker_attack.strategies_used)
            if stronger_attack.strategies_used:
                parent_strategies.extend(stronger_attack.strategies_used)
            
            parent_strategies = list(dict.fromkeys(parent_strategies))
            
            strategy = JailbreakStrategy(
                strategy_id=strategy_id,
                name=analysis["Strategy"],
                definition=analysis["Definition"],
                example_prompt_pj=stronger_attack.attack_prompt,
                example_prompt_pi=weaker_attack.attack_prompt,
                response_solved=weaker_attack.target_response,
                category=analysis.get("category", ""),
                # usage_count counts the observations behind average_score, so a
                # newly discovered strategy already has one: its own. Starting
                # at 0 would make the first merge divide by 1 and throw this
                # score away instead of averaging with it.
                success_rate=1.0 if stronger_attack.score > 5.0 else 0.0,
                average_score=stronger_attack.score,
                usage_count=1,
                discovered_date=datetime.now(timezone.utc),
                source_attack_id=stronger_attack.attack_id,
                parent_strategies=parent_strategies,
                context_embedding=context_embedding,
                effective_against=[stronger_attack.model_used],
                mechanism=analysis.get("mechanism", ""),
                improvement=improvement,
                key_difference=analysis.get("key_difference", "")
            )
            
            return strategy
        
        except json.JSONDecodeError as e:
            print(f"Failed to parse strategy JSON: {e}")
            print(f"Response was: {response}")
            return None
        except Exception as e:
            print(f"Error creating strategy: {e}")
            return None
        
    def _is_novel_strategy(self, strategy: JailbreakStrategy, similarity_threshold: float = 0.85) -> bool:
        """Reject a rediscovery of a strategy the library already holds.

        A matching name alone is not enough. Strategies are retrieved by the
        embedding of the target response they overcame, so the same technique
        found against a different response is a new retrieval anchor and worth
        keeping. Only name *and* context together mark a duplicate, and then
        the existing strategy absorbs the new score rather than being replaced.
        """
        name = strategy.name.strip().lower()
        for existing in self.strategy_library.strategies.values():
            if existing.name.strip().lower() != name:
                continue
            if existing.context_embedding is None or strategy.context_embedding is None:
                # No anchors to tell the contexts apart, so assume the same one.
                similarity = 1.0
            else:
                similarity = self.embedding_manager.compute_similarity(
                    existing.context_embedding, strategy.context_embedding
                )
            if similarity >= similarity_threshold:
                print(
                    f"Rediscovered '{strategy.name}' in a known context "
                    f"(sim: {similarity:.2f}) - merging into {existing.strategy_id}"
                )
                existing.update_effectiveness(strategy.average_score)
                self._emit_merge(existing)
                return False
            print(
                f"Strategy '{strategy.name}' already known, but in a different "
                f"context (sim: {similarity:.2f}) - keeping as a new anchor"
            )
        return True

    def _emit_merge(self, strategy: JailbreakStrategy) -> None:
        """Push a merged strategy's updated stats out to the caller's sink.

        Without this the merge would live only in memory: the discoverer
        returns None for a duplicate, so the phase never emits anything and
        the recomputed average_score would be lost at the end of the run.
        """
        if self.on_strategy_merged is not None:
            self.on_strategy_merged(strategy)

    
    def _group_logs_by_request(self, attack_logs: List[AttackLog]) -> Dict[str, List[AttackLog]]:
        """
        Group attack logs by malicious request for fair comparison
        """
        groups = {}
        for log in attack_logs:
            request = log.malicious_request
            if request not in groups:
                groups[request] = []
            groups[request].append(log)
        
        for request in groups:
            groups[request].sort(key=lambda x: x.score)
        return groups
    
    def _find_improvement_pairs(self, logs: List[AttackLog], min_improvement: float = 1.0) -> List[Tuple[AttackLog, AttackLog]]:
        pairs = []
        # TODO: Redundante, logs já vem ordenada
        sorted_logs = sorted(logs, key=lambda x: x.score)
        for i in range(len(sorted_logs)):
            for j in range(i + 1, len(sorted_logs)):
                weaker = sorted_logs[i]
                stronger = sorted_logs[j]
                improvement = stronger.score - weaker.score
                if improvement >= min_improvement:
                    pairs.append((weaker, stronger))
        
        return pairs[:10]
    
    def _get_existing_strategy_names(self) -> List[str]:
        """
        Get list of existing strategy names to avoid duplicates
        """
        existing_names = []
        for strategy in self.strategy_library.strategies.values():
            existing_names.append(strategy.name)
        
        return existing_names
    
    
class StrategyValidator:
    
    def __init__(self, embedding_Manager: EmbeddingManager):
        self.embedding_manager = embedding_Manager

    def validate_strategy(self, strategy: JailbreakStrategy) -> bool:
        """
        Validate that a strategy meets quality criteria
        """
        return True
    
    def rank_strategies(self, strategies: List[JailbreakStrategy]) -> List[JailbreakStrategy]:
        def strategy_score(strategy):
            base_score = strategy.success_rate * strategy.average_score
            novelty_bonus = 1.0 if strategy.usage_count < 5 else 0.5

            return base_score * novelty_bonus
        
        return sorted(strategies, key=strategy_score, reverse=True)