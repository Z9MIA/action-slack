export interface Issue {
  title: string;
  url: string;
  state: string;
  milestone: {
    title: string;
    url: string;
  };
  created_at: Date;
}
