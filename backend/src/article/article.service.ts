import { EntityManager, QueryOrder, wrap } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/mysql';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';

import { User } from '../user/user.entity';
import { Article } from './article.entity';
import { IArticleRO, IArticlesRO, ICommentsRO } from './article.interface';
import { Comment } from './comment.entity';
import { CreateArticleDto, CreateCommentDto } from './dto';

const EDIT_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

function now() {
  return new Date();
}

function ttlExpiryDate() {
  return new Date(Date.now() - EDIT_LOCK_TTL_MS);
}

function isLockActive(article: Article): boolean {
  return !!article.lockOwner && !!article.lockLastSeenAt && article.lockLastSeenAt > ttlExpiryDate();
}

function ensureCanEdit(userId: number, article: Article) {
  const isAuthor = article.author?.id === userId;
  const isCoAuthor = article.coAuthors?.isInitialized()
    ? article.coAuthors.getItems().some((u) => u.id === userId)
    : false;

  if (!isAuthor && !isCoAuthor) {
    throw new ForbiddenException({ errors: { authorization: ['Not author or co-author'] } });
  }
}

@Injectable()
export class ArticleService {
  constructor(
    private readonly em: EntityManager,
    @InjectRepository(Article)
    private readonly articleRepository: EntityRepository<Article>,
    @InjectRepository(Comment)
    private readonly commentRepository: EntityRepository<Comment>,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
  ) {}

  async findAll(userId: number, query: Record<string, string>): Promise<IArticlesRO> {
    const user = userId
      ? await this.userRepository.findOne(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const qb = this.articleRepository.createQueryBuilder('a').select('a.*').leftJoin('a.author', 'u');

    if ('tag' in query) {
      qb.andWhere({ tagList: new RegExp(query.tag) });
    }

    if ('author' in query) {
      const author = await this.userRepository.findOne({ username: query.author });

      if (!author) {
        return { articles: [], articlesCount: 0 };
      }

      qb.andWhere({ author: author.id });
    }

    if ('favorited' in query) {
      const author = await this.userRepository.findOne({ username: query.favorited }, { populate: ['favorites'] });

      if (!author) {
        return { articles: [], articlesCount: 0 };
      }

      const ids = author.favorites.$.getIdentifiers();
      qb.andWhere({ author: ids });
    }

    qb.orderBy({ createdAt: QueryOrder.DESC });
    const res = await qb.clone().count('id', true).execute('get');
    const articlesCount = res.count;

    if ('limit' in query) {
      qb.limit(+query.limit);
    }

    if ('offset' in query) {
      qb.offset(+query.offset);
    }

    const ids = (await qb.getResult()).map((a) => a.id);
    const articles = await this.articleRepository.find(
      { id: { $in: ids } },
      { populate: ['author', 'coAuthors'] },
    );
    return { articles: articles.map((a) => a.toJSON(user!)), articlesCount };
  }

  async findFeed(userId: number, query: Record<string, string>): Promise<IArticlesRO> {
    const user = userId
      ? await this.userRepository.findOne(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const res = await this.articleRepository.findAndCount(
      { author: { followers: userId } },
      {
        populate: ['author', 'coAuthors'],
        orderBy: { createdAt: QueryOrder.DESC },
        limit: +query.limit,
        offset: +query.offset,
      },
    );

    console.log('findFeed', { articles: res[0], articlesCount: res[1] });
    return { articles: res[0].map((a) => a.toJSON(user!)), articlesCount: res[1] };
  }

  async findOne(userId: number, where: Partial<Article>): Promise<IArticleRO> {
    const user = userId
      ? await this.userRepository.findOneOrFail(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const article = await this.articleRepository.findOne(where, { populate: ['author', 'coAuthors'] });
    return { article: article && article.toJSON(user) } as IArticleRO;
  }

  async addComment(userId: number, slug: string, dto: CreateCommentDto) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author'] });
    const author = await this.userRepository.findOneOrFail(userId);
    const comment = new Comment(author, article, dto.body);
    await this.em.persistAndFlush(comment);

    return { comment, article: article.toJSON(author) };
  }

  async deleteComment(userId: number, slug: string, id: number): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author'] });
    const user = await this.userRepository.findOneOrFail(userId);
    const comment = this.commentRepository.getReference(id);

    if (article.comments.contains(comment)) {
      article.comments.remove(comment);
      await this.em.removeAndFlush(comment);
    }

    return { article: article.toJSON(user) };
  }

  async favorite(id: number, slug: string): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author'] });
    const user = await this.userRepository.findOneOrFail(id, { populate: ['favorites', 'followers'] });

    if (!user.favorites.contains(article)) {
      user.favorites.add(article);
      article.favoritesCount++;
    }

    await this.em.flush();
    return { article: article.toJSON(user) };
  }

  async unFavorite(id: number, slug: string): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author'] });
    const user = await this.userRepository.findOneOrFail(id, { populate: ['followers', 'favorites'] });

    if (user.favorites.contains(article)) {
      user.favorites.remove(article);
      article.favoritesCount--;
    }

    await this.em.flush();
    return { article: article.toJSON(user) };
  }

  async findComments(slug: string): Promise<ICommentsRO> {
    const article = await this.articleRepository.findOne({ slug }, { populate: ['comments'] });
    return { comments: article!.comments.getItems() };
  }

  async create(userId: number, dto: CreateArticleDto) {
    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ['followers', 'favorites', 'articles'] },
    );
    const article = new Article(user!, dto.title, dto.description, dto.body);
    article.tagList.push(...dto.tagList);

    // resolve co-authors if provided
    if (dto.coAuthorUsernames && dto.coAuthorUsernames.length > 0) {
      const coAuthors = await this.userRepository.find({ username: { $in: dto.coAuthorUsernames } });
      const foundUsernames = new Set(coAuthors.map((u) => u.username));
      const missing = dto.coAuthorUsernames.filter((u) => !foundUsernames.has(u));
      if (missing.length > 0) {
        throw new BadRequestException({ errors: { coAuthors: missing.map((u) => `Unknown username: ${u}`) } });
      }
      for (const u of coAuthors) {
        article.coAuthors.add(u);
      }
    }
    user?.articles.add(article);
    await this.em.flush();

    return { article: article.toJSON(user!) };
  }

  async update(userId: number, slug: string, articleData: Partial<CreateArticleDto>): Promise<IArticleRO> {
    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ['followers', 'favorites', 'articles'] },
    );
    const article = await this.articleRepository.findOneOrFail(
      { slug },
      { populate: ['author', 'coAuthors', 'lockOwner'] },
    );

    // authorization: must be author or co-author
    ensureCanEdit(userId, article);

    // enforce active lock ownership
    if (isLockActive(article)) {
      if (article.lockOwner!.id !== userId) {
        const lockedBy = await this.userRepository.findOne(article.lockOwner!.id);
        throw new HttpException(
          { errors: { lock: [`Locked by ${lockedBy?.username ?? 'another user'}`] }, lockedBy: lockedBy?.toJSON() },
          423,
        );
      }
    } else {
      throw new ConflictException({ errors: { lock: ['Edit lock not held'] } });
    }

    // update basic fields
    const assignable: Partial<Article> = {};
    if (typeof articleData.title !== 'undefined') assignable.title = articleData.title as unknown as string;
    if (typeof articleData.description !== 'undefined')
      assignable.description = articleData.description as unknown as string;
    if (typeof articleData.body !== 'undefined') assignable.body = articleData.body as unknown as string;
    if (typeof articleData.tagList !== 'undefined') assignable.tagList = articleData.tagList as unknown as string[];
    wrap(article).assign(assignable);

    // update co-authors if provided
    if (articleData.coAuthorUsernames) {
      const coAuthors = await this.userRepository.find({ username: { $in: articleData.coAuthorUsernames } });
      const foundUsernames = new Set(coAuthors.map((u) => u.username));
      const missing = articleData.coAuthorUsernames.filter((u) => !foundUsernames.has(u));
      if (missing.length > 0) {
        throw new BadRequestException({ errors: { coAuthors: missing.map((u) => `Unknown username: ${u}`) } });
      }
      article.coAuthors.removeAll();
      for (const u of coAuthors) {
        article.coAuthors.add(u);
      }
    }

    // persist changes
    await this.em.flush();

    // release lock on success
    article.lockOwner = null;
    article.lockAcquiredAt = null;
    article.lockLastSeenAt = null;
    await this.em.flush();

    return { article: article!.toJSON(user!) };
  }

  async delete(slug: string) {
    return this.articleRepository.nativeDelete({ slug });
  }

  // --- Lock operations ---
  async acquireLock(userId: number, slug: string) {
    const n = now();
    const expiry = ttlExpiryDate();
    // conditional update: only set lock if none, expired or already owned by the same user
    const result = await this.em.getConnection().execute(
      'update `article` set `lock_owner_id` = ?, `lock_acquired_at` = ?, `lock_last_seen_at` = ? where `slug` = ? and (`lock_owner_id` is null or `lock_last_seen_at` < ? or `lock_owner_id` = ?)',
      [userId, n, n, slug, expiry, userId],
    );

    type ExecResult = { affectedRows?: number } | number | Record<string, unknown> | unknown;
    const r = result as ExecResult;
    let affectedRows = 0;
    if (typeof r === 'number') {
      affectedRows = r;
    } else if (typeof r === 'object' && r !== null && 'affectedRows' in (r as Record<string, unknown>)) {
      affectedRows = (r as { affectedRows?: number }).affectedRows ?? 0;
    }
    if (!affectedRows) {
      const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['lockOwner'] });
      const lockedBy = article.lockOwner ? await this.userRepository.findOne(article.lockOwner.id) : undefined;
      throw new HttpException(
        { errors: { lock: [`Locked by ${lockedBy?.username ?? 'another user'}`] }, lockedBy: lockedBy?.toJSON() },
        423,
      );
    }

    return { ok: true };
  }

  async heartbeatLock(userId: number, slug: string) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['lockOwner'] });
    if (!isLockActive(article) || article.lockOwner?.id !== userId) {
      throw new ConflictException({ errors: { lock: ['Edit lock not held'] } });
    }

    article.lockLastSeenAt = now();
    await this.em.flush();
    return { ok: true };
  }

  async releaseLock(userId: number, slug: string) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['lockOwner'] });
    if (article.lockOwner?.id === userId) {
      article.lockOwner = null;
      article.lockAcquiredAt = null;
      article.lockLastSeenAt = null;
      await this.em.flush();
    } else {
      throw new ConflictException({ errors: { lock: ['Edit lock not held'] } });
    }
    return { ok: true };
  }

  async getLockStatus(slug: string) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['lockOwner'] });
    const active = isLockActive(article);
    const expiresAt = active && article.lockLastSeenAt ? new Date(article.lockLastSeenAt.getTime() + EDIT_LOCK_TTL_MS) : null;
    return {
      lock: {
        isActive: active,
        lockedBy: article.lockOwner ? (await this.userRepository.findOneOrFail(article.lockOwner.id)).toJSON() : null,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    };
  }
}
