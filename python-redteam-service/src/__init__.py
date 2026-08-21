import torch
import torch._dynamo

def initialize_torch_config():
    torch._dynamo.config.disable = True
    torch.set_float32_matmul_precision('high')










initialize_torch_config()