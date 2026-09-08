from unittest.mock import MagicMock, Mock

from server import main


def test_local_target_loading_waits_for_gpu(monkeypatch):
    target_id = "local-target"
    monkeypatch.setitem(main.targets, target_id, {"config": {"kind": "local"}})
    gpu_lock = MagicMock()
    build_target = Mock()
    monkeypatch.setattr(main, "gpu_lock", gpu_lock)
    monkeypatch.setattr(main, "_build_target", build_target)

    main.load_target(target_id)

    gpu_lock.__enter__.assert_called_once_with()
    build_target.assert_called_once_with(target_id)


def test_remote_target_loading_does_not_wait_for_gpu(monkeypatch):
    target_id = "api-target"
    monkeypatch.setitem(main.targets, target_id, {"config": {"kind": "api"}})
    gpu_lock = MagicMock()
    build_target = Mock()
    monkeypatch.setattr(main, "gpu_lock", gpu_lock)
    monkeypatch.setattr(main, "_build_target", build_target)

    main.load_target(target_id)

    gpu_lock.__enter__.assert_not_called()
    build_target.assert_called_once_with(target_id)
