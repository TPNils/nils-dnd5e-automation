declare module 'common/data/fields.mjs' {

  /* ---------------------------------------- */
  /*  Standard Data Types                     */
  /* ---------------------------------------- */

  export type SchemaToType<T> = {
    [P in keyof T]: T[P] extends DocumentField<infer U> ? Array<SchemaToType<U>> : T[P];
    //[P in keyof T]: T[P] extends DocumentField<infer U> ? (T[P]['collection'] extends true ? SchemaToType<Array<U>> : SchemaToType<U>) : T[P]; 
  }

  export interface DocumentField<T> {
    /**
     * An object which defines the data type of this field
     */
    type: T;

    /**
     * Is this field required to have an assigned value? Default is false.
     */
    required: boolean;

    /**
     * Can the field be populated by a null value? Default is true.
     */
    nullable?: boolean;

    /**
     * A static default value or a function which assigns a default value
     */
    default?: PropertyTypeToSourceParameterType<SchemaToType<T>> | ((data?: object) => SchemaToType<T>);

    collection?: boolean;

    /**
     * An optional cleaning function which sanitizes input data to this field
     */
    clean?: (input: unknown) => SchemaToType<T>;

    /**
     * A function which asserts that the value of this field is valid
     */
    validate?: (value: SchemaToType<T>) => boolean;

    /**
     * An error message which is displayed if validation fails
     */
    validationError?: string;

    /**
     * Is the field an embedded Document collection?
     */
    isCollection?: boolean;
  }

  /**
   * A required boolean field which may be used in a Document.
   * @type {DocumentField}
   */
  export const BOOLEAN_FIELD: DocumentField<Boolean>;

  /**
   * A standard string color field which may be used in a Document.
   * @type {DocumentField}
   */
  export const COLOR_FIELD: DocumentField<String>;

  /**
   * A standard string field for an image file path which may be used in a Document.
   * @type {DocumentField}
   */
  export const IMAGE_FIELD: DocumentField<String>;

  /**
   * A standard string field for a video or image file path may be used in a Document.
   * @type {DocumentField}
   */
  export const VIDEO_FIELD: DocumentField<String>;

  /**
   * A standard string field for an audio file path which may be used in a Document.
   * @type {DocumentField}
   */
  export const AUDIO_FIELD: DocumentField<String>;

  /**
   * A standard integer field which may be used in a Document.
   * @type {DocumentField}
   */
  export const INTEGER_FIELD: DocumentField<Number>;

  /**
   * A string field which contains serialized JSON data that may be used in a Document.
   * @type {DocumentField}
   */
  export const JSON_FIELD: DocumentField<String>;

  /**
   * A non-negative integer field which may be used in a Document.
   * @type {DocumentField}
   */
  export const NONNEGATIVE_INTEGER_FIELD: DocumentField<Number>;

  /**
   * A non-negative integer field which may be used in a Document.
   * @type {DocumentField}
   */
  export const POSITIVE_INTEGER_FIELD: DocumentField<Number>;

  /**
   * A template for a required inner-object field which may be used in a Document.
   * @type {DocumentField}
   */
  export const OBJECT_FIELD: DocumentField<Object>;

  /**
   * An optional string field which may be included by a Document.
   * @type {DocumentField}
   */
  export const STRING_FIELD: DocumentField<String>;

  /**
   * An optional numeric field which may be included in a Document.
   * @type {DocumentField}
   */
  export const NUMERIC_FIELD: DocumentField<Number>;

  /**
   * A required numeric field which may be included in a Document and may not be null.
   * @type {DocumentField}
   */
  export const REQUIRED_NUMBER: DocumentField<Number>;

  /**
   * A required numeric field which must be a positive finite value that may be included in a Document.
   * @type {DocumentField}
   */
  export const REQUIRED_POSITIVE_NUMBER: DocumentField<Number>;

  /**
   * A required numeric field which represents an angle of rotation in degrees between 0 and 360.
   * @type {DocumentField}
   */
  export const ANGLE_FIELD: DocumentField<Number>;

  /**
   * A required numeric field which represents a uniform number between 0 and 1.
   * @type {DocumentField}
   */
  export const ALPHA_FIELD: DocumentField<Number>;


  /**
   * A string field which requires a non-blank value and may not be null.
   * @type {DocumentField}
   */
  export const REQUIRED_STRING: DocumentField<String>;

  /**
   * A string field which is required, but may be left blank as an empty string.
   * @type {DocumentField}
   */
  export const BLANK_STRING: DocumentField<String>;

  /**
   * A field used for integer sorting of a Document relative to its siblings
   * @type {DocumentField}
   */
  export const INTEGER_SORT_FIELD: DocumentField<Number>;

  /**
   * A numeric timestamp field which may be used in a Document.
   * @type {DocumentField}
   */
  export const TIMESTAMP_FIELD: DocumentField<Number>;

  /* ---------------------------------------- */
  /*  Special Document Fields                 */
  /* ---------------------------------------- */

  /**
   * The standard identifier for a Document.
   * @type {DocumentField}
   */
  export const DOCUMENT_ID: DocumentField<String>;

  /**
   * The standard permissions object which may be included by a Document.
   * @type {DocumentField}
   */
  export const DOCUMENT_PERMISSIONS: DocumentField<Object>;


  /* ---------------------------------------- */
  /*  Dynamic Fields                          */
  /* ---------------------------------------- */

  /**
   * Create a foreign key field which references a primary Document id
   * @returns {DocumentField}
   */
  export function foreignDocumentField(options): DocumentField<String>;

  /**
   * Create a special field which contains a Collection of embedded Documents
   * @param {Function} document       The Document class definition
   * @param {object} [options={}]     Additional field options
   * @returns {DocumentField}
   */
  export function embeddedCollectionField(document: any, options: {required?: boolean, default?: any} = {}): DocumentField<any>;


  /**
   * Return a document field which is a modification of a static field type
   * @returns {DocumentField}
   */
  export function field<T>(field: DocumentField<T>): DocumentField<T>;
  export function field<T, O>(field: DocumentField<T>, options: Partial<DocumentField<R>> = {}): DocumentField<T & R>;


}

export {};

declare global {
  class Actor {
    static createDocuments(data: Array<ConstructorParameters<typeof foundry.documents.BaseActor>[0]>, context: ConstructorParameters<typeof foundry.documents.BaseActor>[1])
  }
  class ActiveEffect {
    static createDocuments(data: Array<ConstructorParameters<typeof foundry.documents.BaseActiveEffect>[0]>, context: ConstructorParameters<typeof foundry.documents.BaseActiveEffect>[1])
  }
}