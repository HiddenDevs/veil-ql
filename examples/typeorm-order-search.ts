import { Schema } from "../src/index.js";
import type { Literal } from "../src/index.js";
import { applySorts, TypeOrmFilter } from "./typeorm-filter.js";
import type { CompiledSort } from "./typeorm-filter.js";

const orderSchema = Schema.fromObject({
    fields: {
        "order.createdAt": { type: "number", filterable: false, sortable: true },
        "order.status": {
            type: "string",
            values: ["pending", "paid", "shipped", "cancelled"],
        },
        "order.total": { type: "number", sortable: true },
        "customer.email": { type: "string", sortable: true },
    },
});

const orderFilter = new TypeOrmFilter(orderSchema, {
    "order.createdAt": "order.createdAt",
    "order.status": "order.status",
    "order.total": "order.total",
    "customer.email": "customer.email",
});

export interface Order {
    readonly id: number;
    readonly status: string;
    readonly total: number;
}

export interface OrderQueryBuilder extends TypeOrmQueryBuilder<OrderQueryBuilder> {
    leftJoinAndSelect(relation: string, alias: string): this;
    andWhere(condition: string, parameters?: Record<string, Literal>): this;
    orderBy(sort: string, direction: "ASC" | "DESC"): this;
    addOrderBy(sort: string, direction: "ASC" | "DESC"): this;
    skip(count: number): this;
    take(count: number): this;
    getManyAndCount(): Promise<[Order[], number]>;
}

interface TypeOrmQueryBuilder<T> {
    where(condition: string, parameters?: Record<string, Literal>): T;
}

export interface OrderRepository {
    createQueryBuilder(alias: string): OrderQueryBuilder;
}

export interface OrderSearchRequest {
    readonly filter?: string;
    readonly page?: number;
    readonly pageSize?: number;
}

export interface OrderSearchResult {
    readonly items: Order[];
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
}

export class OrderSearchService {
    public async search(
        repository: OrderRepository,
        tenantId: number,
        request: OrderSearchRequest,
    ): Promise<OrderSearchResult> {
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
            throw new RangeError("tenantId must be a positive safe integer");
        }

        const page = request.page ?? 1;
        const pageSize = request.pageSize ?? 25;
        if (!Number.isSafeInteger(page) || page < 1) {
            throw new RangeError("page must be a positive safe integer");
        }
        if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
            throw new RangeError("pageSize must be an integer between 1 and 100");
        }

        const compiledFilter = request.filter === undefined ? undefined : orderFilter.compile(request.filter);
        const query = repository.createQueryBuilder("order").leftJoinAndSelect("order.customer", "customer");

        if (compiledFilter !== undefined) {
            query.where(compiledFilter.sql, { ...compiledFilter.parameters });
            query.andWhere("order.tenantId = :tenantId", { tenantId });
        } else {
            query.where("order.tenantId = :tenantId", { tenantId });
        }

        const sorts: readonly CompiledSort[] =
            compiledFilter?.sorts.length === 0 || compiledFilter === undefined
                ? [{ column: "order.createdAt", direction: "DESC" }]
                : compiledFilter.sorts;
        applySorts(query, sorts);

        const [items, total] = await query
            .skip((page - 1) * pageSize)
            .take(pageSize)
            .getManyAndCount();

        return { items, total, page, pageSize };
    }
}

// In an HTTP handler, normalize query parameters before calling the service.
// const result = await new OrderSearchService().search(orderRepository, 42, {
//     filter: 'order.status IN ["paid", "shipped"] AND order.total >= 100 AND customer.email != "blocked@example.com" SORT BY order.total DESC, customer.email ASC',
//     page: 2,
//     pageSize: 20,
// });
