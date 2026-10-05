_CACHE = {}


def get(key, compute):
    if key not in _CACHE:
        _CACHE[key] = compute()
    return _CACHE[key]
