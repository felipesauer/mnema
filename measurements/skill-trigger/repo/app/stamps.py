from datetime import datetime


def stamp(moment: datetime) -> str:
    return moment.isoformat()
