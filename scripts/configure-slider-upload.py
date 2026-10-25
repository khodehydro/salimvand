"""Raise only CMS API upload limits; preserve Certbot TLS and custom larger limits."""
import re
import sys
from pathlib import Path


def configure(raw):
    def patch(match):
        body = match['body']
        # Ignore commented-out directives without changing source offsets.
        searchable = re.sub(r'#[^\n]*', lambda comment: ' ' * len(comment[0]), body)
        limit = re.search(r'\bclient_max_body_size\s+(\d+)([kKmMgG]?)\s*;', searchable)
        if limit:
            size = int(limit[1]) * {'': 1, 'k': 1024, 'm': 1024**2, 'g': 1024**3}[limit[2].lower()]
            if size == 0 or size >= 6 * 1024**2:
                return match[0]
            body = body[:limit.start()] + 'client_max_body_size 6m;' + body[limit.end():]
        else:
            body = '\n        client_max_body_size 6m;' + body
        return match['head'] + body + '}'
    return re.sub(r'(?P<head>\blocation\s+/api/\s*\{)(?P<body>[^{}]*)\}', patch, raw)


if __name__ == '__main__':
    path = Path(sys.argv[1])
    original = path.read_text()
    updated = configure(original)
    if updated != original:
        path.write_text(updated)
        print('Patched CMS API upload limit to 6m for 5 MB slider images.')
