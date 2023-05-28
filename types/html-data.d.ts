export interface ElementData {
  type: 'element';
  tag: string;
  attributes: Record<string, AttributeData>;
  children: AnyNodeData[];
};

export interface AttributeData {
  name: string;
  quoteType: `` | `'` | `"`
  value: BindableString[];
};

export type BindableString = StringValue | BindExpressionValue;

export interface StringValue {
  type: 'string';
  text: string;
};

export interface BindExpressionValue {
  type: 'bind';
  /**
   * escaped: {{noHtmlElementsWillGenerate}}
   * raw: {{canGenerateHtmlElements}}
   */
  bindMethod: 'escaped' | 'raw';
  text: string;
};

export interface CommentData {
  type: 'comment';
  text: BindableString[];
};

export interface TextData {
  type: 'text';
  text: BindableString[];
};

export type AnyNodeData = ElementData | CommentData | TextData;