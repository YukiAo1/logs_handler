from datetime import datetime, timezone
from dataclasses import dataclass, field


@dataclass
class FilterRule:
    id: int | None = None
    name: str = ''
    pattern: str = ''
    description: str = ''
    group_name: str = ''
    sort_order: int = 0
    created_at: str = ''
    updated_at: str = ''

    @staticmethod
    def from_row(row) -> 'FilterRule':
        return FilterRule(
            id=row['id'],
            name=row['name'],
            pattern=row['pattern'],
            description=row['description'],
            group_name=row['group_name'] or '',
            sort_order=row['sort_order'] or 0,
            created_at=row['created_at'],
            updated_at=row['updated_at'],
        )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'pattern': self.pattern,
            'description': self.description,
            'group_name': self.group_name,
            'sort_order': self.sort_order,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
        }


@dataclass
class ClassicScenario:
    id: int | None = None
    title: str = ''
    note: str = ''
    created_at: str = ''
    updated_at: str = ''

    @staticmethod
    def from_row(row) -> 'ClassicScenario':
        return ClassicScenario(
            id=row['id'],
            title=row['title'],
            note=row['note'],
            created_at=row['created_at'],
            updated_at=row['updated_at'],
        )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'title': self.title,
            'note': self.note,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
        }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()