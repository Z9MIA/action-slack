export interface Issue {
  number: number;
  title: string;
  milestone?: {
    title: string;
  };
  created?: string;
}
