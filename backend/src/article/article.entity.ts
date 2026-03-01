import {
  ArrayType,
  Collection,
  Entity,
  EntityDTO,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  wrap,
  ManyToMany,
} from '@mikro-orm/core';
import slug from 'slug';

import { User } from '../user/user.entity';
import { Comment } from './comment.entity';

@Entity()
export class Article {
  @PrimaryKey({ type: 'number' })
  id: number;

  @Property({ fieldName: 'slug' })
  slug: string;

  @Property({ fieldName: 'title' })
  title: string;

  @Property({ fieldName: 'description' })
  description = '';

  @Property({ fieldName: 'body' })
  body = '';

  @Property({ type: 'date', fieldName: 'created_at' })
  createdAt = new Date();

  @Property({ type: 'date', onUpdate: () => new Date(), fieldName: 'updated_at' })
  updatedAt = new Date();

  @Property({ type: ArrayType, fieldName: 'tag_list' })
  tagList: string[] = [];

  @ManyToOne(() => User, { fieldName: 'author_id' })
  author: User;

  // Co-authors of the article (ManyToMany with pivot table)
  @ManyToMany({
    entity: () => User,
    owner: true,
    pivotTable: 'article_co_authors',
    joinColumn: 'article_id',
    inverseJoinColumn: 'user_id',
    hidden: true,
  })
  coAuthors = new Collection<User>(this);

  @OneToMany(() => Comment, (comment) => comment.article, { eager: true, orphanRemoval: true })
  comments = new Collection<Comment>(this);

  @Property({ type: 'number', fieldName: 'favorites_count' })
  favoritesCount = 0;

  // Optimistic edit lock fields
  @ManyToOne(() => User, { nullable: true, fieldName: 'lock_owner_id', hidden: true })
  lockOwner?: User | null;

  @Property({ type: 'date', nullable: true, fieldName: 'lock_acquired_at', hidden: true })
  lockAcquiredAt?: Date | null;

  @Property({ type: 'date', nullable: true, fieldName: 'lock_last_seen_at', hidden: true })
  lockLastSeenAt?: Date | null;


  constructor(author: User, title: string, description: string, body: string) {
    this.author = author;
    this.title = title;
    this.description = description;
    this.body = body;
    this.slug = slug(title, { lower: true }) + '-' + ((Math.random() * Math.pow(36, 6)) | 0).toString(36);
  }

  toJSON(user?: User) {
    const o = wrap<Article>(this).toObject() as ArticleDTO;
    o.favorited = user && user.favorites.isInitialized() ? user.favorites.contains(this) : false;
    o.author = this.author.toJSON(user);
    // expose co-authors as profiles when relation is loaded
    if (this.coAuthors?.isInitialized()) {
      o.coAuthors = this.coAuthors.getItems().map((u) => u.toJSON(user));
    } else {
      o.coAuthors = [];
    }
    // canEdit flag derived from author or co-author membership
    const viewerId = user?.id;
    o.canEdit = !!viewerId && (this.author?.id === viewerId || (this.coAuthors?.isInitialized() && this.coAuthors.getItems().some((u) => u.id === viewerId)));

    return o;
  }
}

export interface ArticleDTO extends Omit<EntityDTO<Article>, 'coAuthors'> {
  favorited?: boolean;
  coAuthors?: import('../user/user.entity').UserDTO[];
  canEdit?: boolean;
}
