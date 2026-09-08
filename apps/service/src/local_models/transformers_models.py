import gc
from threading import Thread
from typing import Iterator
from src.interfaces.local_models_interface import LocalModel
from transformers.pipelines import pipeline
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
import torch
from src.utils.dev import *
from datetime import datetime
from ..utils.dev import *

class LocalModelTransformers(LocalModel):
    def __init__(self, model_name, max_new_tokens: int = 4096, temperature: float = 0.7, device: str = "auto", function: str = "not specified", load_4_bits: bool = False):
        super().__init__(model_name)
        self.tokenizer = AutoTokenizer.from_pretrained(model_name, padding_side="left")
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                device_map=device,
                load_in_4bit=load_4_bits or None,
                torch_dtype=torch.bfloat16,
                #attn_implementation="flash_attention_2"
        )
        
        self.function = function
        self.debugging_mode = DEBUGGING_MODE

    
    def wrapper(self, response: str):
        tag = "[END OF JAILBREAK PROMPT]"
        if tag in response:
            return response.split(tag)[0]
        else:
            return response
            


    
            

    def generate(self, user_prompt: str, system_prompt: str = None, max_tokens: int = MAX_TOKENS_EXP, temperature: float = TEMP_ZERO, function: str = "not specified", condition: str = "") -> str:
        start = datetime.now()
        output_ids = None
        inputs = None
        generation_params = {
            "max_new_tokens": max_tokens,
            "pad_token_id": self.tokenizer.eos_token_id
        }
        if temperature > 0.0:
            generation_params['do_sample'] = True
            generation_params["temperature"] = temperature
            

        with torch.inference_mode():
            if self.tokenizer.chat_template:
                try:
                    # Trying use chat template
                    messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ] if system_prompt else [{"role": "user", "content": user_prompt}]
                    plain_text = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                    plain_text += condition
                    inputs = self.tokenizer(plain_text, return_tensors="pt")
                    inputs = {k: v.to(self.model.device) for k, v in inputs.items()}

                except Exception as e:
                    print(f"Could not apply chat template with system role ({e}). Retrying with user role only.")
                    plain_text = f"{system_prompt}\n\n{user_prompt}" if system_prompt else user_prompt
                    plain_text += condition
                    messages = [{"role": "user", "content": plain_text}]
                    inputs = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                    inputs = self.tokenizer(plain_text, return_tensors="pt")
                    inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
            else:
                # Model does not have a chat template
                print(f"Models does not have a chat template. Using standard str")
                plain_text = f"{system_prompt}\n\n{user_prompt}" if system_prompt else user_prompt
                plain_text += condition
                inputs = self.tokenizer(plain_text, return_tensors="pt")
                inputs = {k: v.to(self.model.device) for k, v in inputs.items()}

            if isinstance(inputs, dict):
                output_ids = self.model.generate(**inputs, **generation_params)    
                input_length = inputs['input_ids'].shape[1]
            else:
                attention_mask = torch.ones_like(inputs)
                output_ids = self.model.generate(input_ids=inputs, attention_mask=attention_mask, **generation_params)
                input_length = inputs.shape[1]

        
        generated_tokens = output_ids[0][input_length:]
        final_response = self.tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()
        if function == "attacker":
            final_response = self.wrapper(final_response)
        ## Debugging
        if SHOW_RESPONSES == True:
                input_ids_for_decode = None
                if isinstance(inputs, dict):
                    input_ids_for_decode = inputs['input_ids'][0]
                else:
                    input_ids_for_decode = inputs[0]
                prompt_decoded = self.tokenizer.decode(input_ids_for_decode, skip_special_tokens=True)
                print(f"\n\nFunction: {function}")
                print(f"Prompt:\n{prompt_decoded}")
                print(f"Target response:\n{final_response}")
                print(f"{datetime.now() - start} on {function}")

        return final_response
        

    def _prepare_chat_inputs(self, user_prompt: str, system_prompt: str = None):
        if self.tokenizer.chat_template:
            try:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ] if system_prompt else [{"role": "user", "content": user_prompt}]
                text = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            except Exception:
                # Some templates reject a system role: fold it into the user turn.
                merged = f"{system_prompt}\n\n{user_prompt}" if system_prompt else user_prompt
                text = self.tokenizer.apply_chat_template(
                    [{"role": "user", "content": merged}], tokenize=False, add_generation_prompt=True
                )
        else:
            text = f"{system_prompt}\n\n{user_prompt}" if system_prompt else user_prompt

        inputs = self.tokenizer(text, return_tensors="pt")
        return {k: v.to(self.model.device) for k, v in inputs.items()}

    def stream_generate(self, user_prompt: str, system_prompt: str = None, max_tokens: int = MAX_TOKENS_EXP, temperature: float = TEMP_ZERO) -> Iterator[str]:
        """Yield the reply token-by-token as it is generated (for a typing effect).

        `model.generate` runs in a worker thread writing into a streamer we drain
        here; a failure inside it is stored and re-raised once the stream ends,
        so the caller sees the error instead of a silently truncated reply.
        """
        inputs = self._prepare_chat_inputs(user_prompt, system_prompt)
        streamer = TextIteratorStreamer(self.tokenizer, skip_prompt=True, skip_special_tokens=True)
        generation_params = {
            "max_new_tokens": max_tokens,
            "pad_token_id": self.tokenizer.eos_token_id,
            "streamer": streamer,
            **inputs,
        }
        if temperature > 0.0:
            generation_params["do_sample"] = True
            generation_params["temperature"] = temperature

        error = {}

        def _worker():
            try:
                with torch.inference_mode():
                    self.model.generate(**generation_params)
            except Exception as e:
                error["err"] = e

        thread = Thread(target=_worker)
        thread.start()
        try:
            for text in streamer:
                if text:
                    yield text
        finally:
            thread.join()
        if "err" in error:
            raise error["err"]

    def _get_response_dict(self, output):
        """
        Get the text from the LLM response
        """
        for response_dict in output['generated_text']:
            if 'assistant' in response_dict.values():
                return response_dict
        return None
    
    
        
    def transformers_generate_directly(self):
        pass

    def unload(self):
        # gc.collect() first: empty_cache() only returns blocks whose tensors are
        # already unreachable, and dropping the attributes is not enough on its own.
        for attr in ("model", "tokenizer"):
            if hasattr(self, attr):
                delattr(self, attr)
        gc.collect()
        torch.cuda.empty_cache()
        print(f"GPU memory released for {self.model_name}")

