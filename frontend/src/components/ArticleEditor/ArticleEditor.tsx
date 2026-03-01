import React from 'react';
import { store } from '../../state/store';
import { useStore } from '../../state/storeHooks';
import { buildGenericFormField } from '../../types/genericFormField';
import { ContainerPage } from '../ContainerPage/ContainerPage';
import { GenericForm } from '../GenericForm/GenericForm';
import { addTag, EditorState, removeTag, updateField, setCoAuthors } from './ArticleEditor.slice';
import { CoAuthorSelector } from './CoAuthorSelector';

export function ArticleEditor({ onSubmit }: { onSubmit: (ev: React.FormEvent) => void }) {
  const { article, submitting, tag, coAuthor, errors } = useStore(({ editor }) => editor);
  return (
    <div className='editor-page'>
      <ContainerPage>
        <div className='col-md-10 offset-md-1 col-xs-12'>
          <CoAuthorSelector
            selected={article.coAuthorUsernames}
            disabled={submitting}
            onChange={(usernames) => store.dispatch(setCoAuthors(usernames))}
          />

          <GenericForm
            formObject={{ ...article, tag, coAuthor } as unknown as Record<string, string | null>}
            disabled={submitting}
            errors={errors}
            onChange={onUpdateField}
            onSubmit={onSubmit}
            submitButtonText='Publish Article'
            onAddItemToList={onAddItemToList}
            onRemoveListItem={onRemoveItemFromList}
            fields={[
              buildGenericFormField({ name: 'title', placeholder: 'Article Title' }),
              buildGenericFormField({ name: 'description', placeholder: "What's this article about?", lg: false }),
              buildGenericFormField({
                name: 'body',
                placeholder: 'Write your article (in markdown)',
                fieldType: 'textarea',
                rows: 8,
                lg: false,
              }),
              buildGenericFormField({
                name: 'tag',
                placeholder: 'Enter the tag name and press enter',
                listName: 'tagList',
                fieldType: 'list',
                lg: false,
              }),
            ]}
          />
        </div>
      </ContainerPage>
    </div>
  );
}

function onUpdateField(name: string, value: string) {
  store.dispatch(updateField({ name: name as keyof EditorState['article'], value }));
}

function onAddItemToList(listName: string) {
  if (listName === 'tagList') return store.dispatch(addTag());
}

function onRemoveItemFromList(listName: string, index: number) {
  if (listName === 'tagList') return store.dispatch(removeTag(index));
}
