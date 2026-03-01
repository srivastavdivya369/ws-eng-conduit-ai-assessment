import React, { Fragment, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { acquireLock, getArticle, heartbeatLock, releaseLock, updateArticle } from '../../../services/conduit';
import { store } from '../../../state/store';
import { useStore } from '../../../state/storeHooks';
import { ArticleEditor } from '../../ArticleEditor/ArticleEditor';
import { initializeEditor, loadArticle, setCoAuthors, startSubmitting, updateErrors } from '../../ArticleEditor/ArticleEditor.slice';

export function EditArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { loading } = useStore(({ editor }) => editor);

  const lockInterval = useRef<number | null>(null);

  useEffect(() => {
    _loadArticle(slug!);

    return () => {
      // release lock on unmount
      if (slug) releaseLock(slug);
      if (lockInterval.current) {
        window.clearInterval(lockInterval.current);
      }
    };
  }, [slug]);

  return <Fragment>{!loading && <ArticleEditor onSubmit={onSubmit(slug!, lockInterval)} />}</Fragment>;
}

async function _loadArticle(slug: string) {
  store.dispatch(initializeEditor());
  try {
    const { title, description, body, tagList, coAuthors, canEdit } = await getArticle(slug);

    if (!canEdit) {
      location.hash = '#/';
      return;
    }

    store.dispatch(loadArticle({ title, description, body, tagList, coAuthorUsernames: [] }));
    if (coAuthors && coAuthors.length > 0) {
      store.dispatch(setCoAuthors(coAuthors.map((p) => p.username)));
    }
  } catch {
    location.hash = '#/';
  }
}

function onSubmit(slug: string, lockInterval: React.MutableRefObject<number | null>): (ev: React.FormEvent) => void {
  return async (ev) => {
    ev.preventDefault();
    // try to acquire lock before submit
    const lock = await acquireLock(slug);
    if (lock.isErr()) {
      store.dispatch(updateErrors(lock.unwrapErr()));
      return;
    }
    // heartbeat while submitting (in case of long operations)
    lockInterval.current = window.setInterval(async () => {
      const hb = await heartbeatLock(slug);
      if (hb.isErr()) {
        window.clearInterval(lockInterval.current!);
      }
    }, 30_000);

    store.dispatch(startSubmitting());
    const result = await updateArticle(slug, store.getState().editor.article);

    result.match({
      err: (errors) => store.dispatch(updateErrors(errors)),
      ok: ({ slug }) => {
        if (lockInterval.current) window.clearInterval(lockInterval.current);
        releaseLock(slug);
        location.hash = `#/article/${slug}`;
      },
    });
  };
}
