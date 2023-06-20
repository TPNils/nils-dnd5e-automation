import type { M } from "ts-algebra";

export type SchemaTypeOf<T> = T extends Array<infer F>
 ? (M.$Array<SchemaTypeOf<F>>)
 : (T extends boolean | number | string
  ? M.Primitive<T>
  : (
    T extends M.Type
    ? T
    : (T extends Function | Date | Symbol | undefined
      ? M.Any
      :(
      T extends object
      ? (
        M.$Object<
        {
          [key in keyof T]: (T[key] extends {isCollection: true}
            // ? (EmbeddedCollection<T[key]['type'][keyof T[key]['type']], any>)
            ? (M.Any)
            // ? (M.Primitive<number>)
            // ? SchemaOf<{test: true}>
            : (T[key] extends (DocumentField<infer F>)
              ? (
                F extends boolean | number | string
                  ? M.Primitive<F>
                  : SchemaTypeOf<F>
              )
              : SchemaTypeOf<T[key]>
            )
          )
        },
        keyof T // TODO everything is optional now
      >
      )
      : M.Any
    ))
  )
 )

export type SchemaOf<T> = M.$Resolve<SchemaTypeOf<T>>