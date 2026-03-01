import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Profile } from '../../types/profile';
import { searchUsers } from '../../services/conduit';

export function CoAuthorSelector({
  selectedUsernames,
  selectedIdsCsv,
  onChange,
  disabled,
}: {
  selectedUsernames: string[];
  selectedIdsCsv?: string;
  onChange: (usernames: string[], idsCsv: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // load all users once, then filter client-side
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const { users } = await searchUsers('', 1000, 0);
        if (!ignore) setAllUsers(users);
      } catch {
        if (!ignore) setAllUsers([]);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const ids = useMemo<number[]>(() =>
    (selectedIdsCsv || '')
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n)),
  [selectedIdsCsv]);

  const userMap = useMemo(() => new Map(allUsers.map((u) => [u.username, u.id])), [allUsers]);

  function toCsv(values: number[]) {
    const uniq = Array.from(new Set(values));
    return uniq.join(',');
  }

  function add(username: string) {
    if (disabled) return;
    const id = userMap.get(username);
    const usernames = selectedUsernames;
    let nextUsernames = usernames;
    let nextIds = ids;
    if (!usernames.includes(username)) {
      nextUsernames = [...usernames, username];
    }
    if (id && !ids.includes(id)) {
      nextIds = [...ids, id];
    }
    onChange(nextUsernames, toCsv(nextIds));
    setQuery('');
    setOpen(false);
  }

  function remove(username: string) {
    if (disabled) return;
    const id = userMap.get(username);
    const nextUsernames = selectedUsernames.filter((u) => u !== username);
    const nextIds = id ? ids.filter((n) => n !== id) : ids;
    onChange(nextUsernames, toCsv(nextIds));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? allUsers.filter((u) => u.username.toLowerCase().includes(q) || (u.bio || '').toLowerCase().includes(q))
      : allUsers;
    return filtered.filter((u) => !selectedUsernames.includes(u.username));
  }, [allUsers, query, selectedUsernames]);

  return (
    <div ref={containerRef} className="form-group" style={{ position: 'relative' }}>
      <label style={{ display: 'block', marginBottom: 6 }}>Co-authors</label>
      <div className="tag-list" style={{ marginBottom: 8 }}>
        {selectedUsernames.map((u) => (
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
