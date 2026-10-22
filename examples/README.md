# Examples

These examples show how to use Veil QL in an application. Veil QL parses and
validates a filter; application code is responsible for translating the AST
into its database query.

## TypeORM

[`typeorm-filter.ts`](./typeorm-filter.ts) demonstrates a small adapter for
TypeORM's `SelectQueryBuilder`. It validates an incoming filter against an
application schema, translates supported AST nodes, and binds literal values
as query parameters. The explicit `columns` map ensures a filter can only
reference columns the application chooses to expose.

The `TypeOrmFilter` class packages schema validation and translation so you can
reuse it across requests:

```ts
const userFilter = new TypeOrmFilter(schema, {
    "user.age": "user.age",
    "user.status": "user.status",
});

const users = await userFilter
    .applyTo(userRepository.createQueryBuilder("user"), "user.age >= 18 SORT BY user.age DESC, user.status ASC")
    .getMany();
```

`applyTo` accepts TypeORM's query builder structurally, so the example does not
add TypeORM as a dependency. It compiles the filter, validates every sort path
against the adapter's explicit column map, then applies filter parameters and
sort order. The caller still decides when to execute the query with `.getMany()`.

The example supports `AND`, `OR`, `NOT`, comparisons, and `IN`/`NOT IN` with
literal lists. It deliberately does not translate function calls such as
`contains`; add a deliberate mapping for any additional Veil QL operation your
application wants to support. Keep schema fields and the TypeORM column map in
sync with the fields actually exposed by your API.

TypeORM is not a dependency of Veil QL. To inspect the compiled filter and
sorts without executing a database query:

```ts
const compiled = userFilter.compile('user.status == "active" SORT BY user.age DESC');
// compiled.sorts: [{ column: "user.age", direction: "DESC" }]
```

To execute a query, pass a repository's query builder to `applyTo`. The mapped
column strings must be TypeORM property paths valid for the query builder alias
(`user` in this example). Do not construct them from user input.

```ts
const users = await userFilter.applyTo(userRepository.createQueryBuilder("user"), request.query.filter).getMany();
```

Sort-only paths may be included in the column map even when they are not
filterable fields in the Veil QL schema. They are accepted for sorting only,
while filter fields still require schema validation:

```ts
const compiled = userFilter.compile('user.status == "active" SORT BY user.age DESC');
const results = await userRepository
    .createQueryBuilder("user")
    .where(compiled.sql, { ...compiled.parameters })
    .orderBy(compiled.sorts[0].column, compiled.sorts[0].direction)
    .getMany();
```

For multiple sort fields, the adapter calls `orderBy` for the first and
`addOrderBy` for subsequent entries. The example service uses `order.createdAt
DESC` as a default only when the filter query has no explicit `SORT BY`.

## Order search service

[`typeorm-order-search.ts`](./typeorm-order-search.ts) builds on the filter
adapter for a more complete endpoint-style example. `OrderSearchService`
validates the tenant, filter, sort field, sort direction, and pagination;
joins the customer relation; applies a mandatory tenant constraint; and returns
the current page along with the total match count.

An example filter can combine allowed order statuses, a minimum total, and a
related customer's email, then sort by total followed by customer email:

```text
order.status IN ["paid", "shipped"] AND order.total >= 100 AND customer.email != "blocked@example.com" SORT BY order.total DESC, customer.email ASC
```

The filter schema limits status values and only exposes the fields listed in
its TypeORM column map. Tenant ID is supplied by trusted application context
rather than the filter. The sample uses TypeORM-compatible structural
interfaces and does not require TypeORM to be installed in this project.

Sorting is part of the filter string, not separate request fields. The service
uses `order.createdAt DESC` only as a default when the query omits `SORT BY`;
otherwise it applies the parsed fields and directions after checking them
against the column map.
