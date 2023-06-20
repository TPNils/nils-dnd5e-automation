type SchemaTypeOf<T> = T extends Array<infer F>
 ? (Array<SchemaTypeOf<F>>)
 : (T extends DocumentField<any> & {isCollection: true}
  ? EmbeddedCollection<any, any>
  : (T extends (DocumentField<infer F>)
    ? SchemaTypeOf<F>
    : (T extends object 
        ? ({[P in keyof T]: SchemaTypeOf<T[P]>})
        : T
      )
    )
  )

export type SchemaOf<T> = $SchemaTypeOf<T>;