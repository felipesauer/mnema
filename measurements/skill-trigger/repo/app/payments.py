import time


def charge(gateway, amount, attempts=3):
    for _ in range(attempts):
        if gateway.charge(amount):
            return True
        time.sleep(1)
    return False
