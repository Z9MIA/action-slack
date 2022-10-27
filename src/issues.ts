export interface Issue {
  title: string;
  html_url: string;
  state: string;
  assignee?: {
    login: string;
  };
  milestone?: {
    title: string;
    url: string;
  };
  created_at: string;
}
