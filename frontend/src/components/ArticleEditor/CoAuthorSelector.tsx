import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Profile } from '../../types/profile';
import { searchUsers } from '../../services/conduit';

export function CoAuthorSelector({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (usernames: string[]) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      try {
        const { users } = await searchUsers(query, 10, 0);
        if (!ignore) setResults(users);
      } catch {
        if (!ignore) setResults([]);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [query]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  function add(username: string) {
    if (disabled) return;
    if (!selected.includes(username)) {
      onChange([...selected, username]);
    }
    setQuery('');
    setOpen(false);
  }

  function remove(username: string) {
    if (disabled) return;
    onChange(selected.filter((u) => u !== username));
  }

  const filtered = useMemo(
    () => results.filter((u) => !selected.includes(u.username)),
    [results, selected],
  );

  return (
    <div ref={containerRef} className="form-group" style={{ position: 'relative' }}>
      <label style={{ display: 'block', marginBottom: 6 }}>Co-authors</label>
      <div className="tag-list" style={{ marginBottom: 8 }}>
        {selected.map((u) => (
          <span key={u} className="tag-default tag-pill" onClick={() => remove(u)}>
            <i className="ion-close-round"></i>
            {u}
          </span>
        ))}
      </div>
      <input
        className="form-control"
        type="text"
        placeholder="Search users and click to add"
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <ul
          className="dropdown-menu"
          style={{ display: 'block', width: '100%', maxHeight: 240, overflowY: 'auto' }}
        >
          {filtered.map((u) => (
            <li key={u.username}>
              <a onClick={(e) => { e.preventDefault(); add(u.username); }} href="#">
                {u.username}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
