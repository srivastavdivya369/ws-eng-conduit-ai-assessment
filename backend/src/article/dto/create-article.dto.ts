export class CreateArticleDto {
  readonly title: string;
  readonly description: string;
  readonly body: string;
  readonly tagList: string[];
  readonly coAuthorUsernames?: string[];
  // optional comma separated list of user IDs for co-authors
  readonly coAuthorIdsCsv?: string;
}
