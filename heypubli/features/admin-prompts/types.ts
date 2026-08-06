/** Where the prompt actually is, relative to the post we found it in. */
export type PromptStyle = "post" | "likely" | "replies" | "named";

export interface PromptEntry {
  /** X post id, unique. */
  id: string;
  /** X handle without the @. */
  handle: string;
  /** Display name on the day we read it. */
  name: string;
  /** Follower count on the day we read it. 0 when the profile would not load. */
  followers: number;
  style: PromptStyle;
  url: string;
  /** YYYY-MM-DD. */
  postedAt: string;
  views: number;
  likes: number;
  /** Full post text. For style "post" this is the prompt itself. */
  text: string;
}
