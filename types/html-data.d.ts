export interface ElementData {
  type: 'element';
  tag: string;
  attributes: Record<string, AttributeData>;
  children: AnyNodeData[];
};

export interface AttributeData {
  name: string;
  quoteType: `` | `'` | `"`
  value?: string;
};

export interface CommentData {
  type: 'comment';
  text: string;
};

export interface TextData {
  type: 'text';
  text: string;
};

export type AnyNodeData = ElementData | CommentData | TextData;