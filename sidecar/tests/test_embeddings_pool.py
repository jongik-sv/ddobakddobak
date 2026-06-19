import torch
from app.embeddings.encoder import pool_cls_normalize


def test_pool_takes_cls_token_and_normalizes():
    # batch=1, seq=3, hidden=4 — CLS(0번 토큰)만 사용
    h = torch.tensor([[[3.0, 4.0, 0.0, 0.0],   # CLS → norm 5
                       [9.0, 9.0, 9.0, 9.0],    # 무시돼야 함
                       [1.0, 0.0, 0.0, 0.0]]])
    out = pool_cls_normalize(h)
    assert out.shape == (1, 4)
    # L2 정규화: [3,4,0,0]/5 = [0.6, 0.8, 0, 0]
    assert torch.allclose(out[0], torch.tensor([0.6, 0.8, 0.0, 0.0]), atol=1e-5)
    assert torch.allclose(out.norm(dim=1), torch.ones(1), atol=1e-5)
