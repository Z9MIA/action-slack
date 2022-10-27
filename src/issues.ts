export class Issue {
  constructor(
    public title: string,
    public node_id: string,
    public html_url: string,
    public state: string,
    public created_at: string,
    public assignee?: {
      login: string;
    },
    public milestone?: {
      title: string;
      url: string;
      html_url: string;
    },
  ) {}
}
