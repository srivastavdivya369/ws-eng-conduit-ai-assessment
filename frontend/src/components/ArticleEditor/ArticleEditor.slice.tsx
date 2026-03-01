import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ArticleForEditor } from '../../types/article';
import * as R from 'ramda';
import { GenericErrors } from '../../types/error';

export interface EditorState {
  article: ArticleForEditor;
  tag: string;
  coAuthor: string;
  submitting: boolean;
  errors: GenericErrors;
  loading: boolean;
}

const initialState: EditorState = {
  article: { title: '', body: '', tagList: [], description: '', coAuthorUsernames: [], coAuthorIdsCsv: '' },
  tag: '',
  coAuthor: '',
  submitting: false,
  errors: {},
  loading: true,
};

const slice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    initializeEditor: () => initialState,
    updateField: (
      state,
      {
        payload: { name, value },
      }: PayloadAction<{
        name: keyof EditorState['article'] | 'tag' | 'coAuthor';
        value: string;
      }>,
    ) => {
      if (name === 'tag') {
        state.tag = value;
        return;
      }
      if (name === 'coAuthor') {
        state.coAuthor = value;
        return;
      }
      if (name !== 'tagList' && name !== 'coAuthorUsernames') {
        state.article[name as keyof EditorState['article']] = value as any;
      }
    },
    updateErrors: (state, { payload: errors }: PayloadAction<GenericErrors>) => {
      state.errors = errors;
      state.submitting = false;
    },
    startSubmitting: (state) => {
      state.submitting = true;
    },
    addTag: (state) => {
      if (state.tag.length > 0) {
        state.article.tagList.push(state.tag);
        state.tag = '';
      }
    },
    addCoAuthor: (state) => {
      const list = state.article.coAuthorUsernames ?? (state.article.coAuthorUsernames = []);
      if (state.coAuthor.length > 0 && !list.includes(state.coAuthor)) {
        list.push(state.coAuthor);
        state.coAuthor = '';
      }
    },
    removeTag: (state, { payload: index }: PayloadAction<number>) => {
      state.article.tagList = R.remove(index, 1, state.article.tagList);
    },
    removeCoAuthor: (state, { payload: index }: PayloadAction<number>) => {
      state.article.coAuthorUsernames = R.remove(index, 1, state.article.coAuthorUsernames ?? []);
    },
    setCoAuthors: (state, { payload }: PayloadAction<{ usernames: string[]; idsCsv: string }>) => {
      state.article.coAuthorUsernames = payload.usernames;
      state.article.coAuthorIdsCsv = payload.idsCsv;
    },
    loadArticle: (state, { payload: article }: PayloadAction<ArticleForEditor>) => {
      state.article = article;
      state.loading = false;
    },
  },
});

export const {
  initializeEditor,
  updateField,
  startSubmitting,
  addTag,
  removeTag,
  addCoAuthor,
  removeCoAuthor,
  setCoAuthors,
  updateErrors,
  loadArticle,
} = slice.actions;

export default slice.reducer;
