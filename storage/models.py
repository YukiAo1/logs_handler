from datetime import datetime, timezone
from dataclasses import dataclass, field


@dataclass
class FilterRule:
    id: int | None = None
    name: str = ''
    pattern: str = ''
    description: str = ''
    created_at: str = ''
    updated_at: str = ''

    @staticmethod
    def from_row(row) -> 'FilterRule':
        return FilterRule(
            id=row['id'],
            name=row['name'],
            pattern=row['pattern'],
            description=row['description'],
            created_at=row['created_at'],
            updated_at=row['updated_at'],
        )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'pattern': self.pattern,
            'description': self.description,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
        }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()