type RequiredKeys<T> = { [K in keyof T]-?: T[K] extends DocumentField<any> ? (T[K] extends {required: true} ? K : never) : ({} extends Pick<T, K> ? never : K) }[keyof T];
type OptionalKeys<T> = { [K in keyof T]-?: T[K] extends DocumentField<any> ? (T[K] extends {required?: false} ? K : never) : ({} extends Pick<T, K> ? K : never) }[keyof T];

export type SchemaOf<T> = T extends Array<infer F>
 ? (Array<SchemaOf<F>>)
 : (T extends DocumentField<any> & {isCollection: true}
  ? EmbeddedCollection<any, any>
  : (T extends (DocumentField<infer F>)
    ? SchemaOf<F>
    : (T extends object 
        ? ({
          [P in RequiredKeys<T>]-?: SchemaOf<T[P]>;
        } & {
          [P in OptionalKeys<T>]?: SchemaOf<T[P]>;
        })
        : T
      )
    )
  )