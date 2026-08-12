// 模拟真实消费端 ts-client.g.ts 产物
// 不含 export enum，含 Connection 双参数别名、OperationFilterInput 家族
import type { ChainablePromise, Connection, Edge } from "@tkwf/tsclient";

export const Query = {
  paymentLog: { field: "paymentLog", type: "query" },
  paymentLogs: { field: "paymentLogs", type: "query" },
  merchant: { field: "merchant", type: "query" },
} as const;

export const Mutation = {
  createPaymentLog: { field: "createPaymentLog", type: "mutation" },
  updatePaymentLog: { field: "updatePaymentLog", type: "mutation" },
  deletePaymentLog: { field: "deletePaymentLog", type: "mutation" },
} as const;

export const operationSelection = {
  paymentLog: "id uId status createTime",
  paymentLogs: "id uId status createTime",
} as const;

// ── Service 接口 ──

export interface PaymentLogService {
  paymentLog(args?: PaymentLogArgs): ChainablePromise<PaymentLog>;
  paymentLogs(args?: PaymentLogsArgs): ChainablePromise<PaymentLogConnection>;
  createPaymentLog(args?: CreatePaymentLogArgs | CreatePaymentLogInput): ChainablePromise<PaymentLog>;
  updatePaymentLog(args?: UpdatePaymentLogArgs): ChainablePromise<PaymentLog>;
  deletePaymentLog(args?: DeletePaymentLogArgs): ChainablePromise<boolean>;
}

export interface MerchantService {
  merchant(args?: MerchantArgs): ChainablePromise<MerchantConnection>;
}

// ── Args 接口 ──

export interface PaymentLogArgs {
  id: number;
}

export interface PaymentLogsArgs {
  first?: number;
  after?: string;
  where?: PaymentLogFilterInput;
  order?: Array<PaymentLogSortInput>;
}

export interface CreatePaymentLogArgs {
  input: CreatePaymentLogInput;
}

export interface CreatePaymentLogInput {
  uId: string;
  status: string;
  createTime: string;
}

export interface UpdatePaymentLogArgs {
  id: number;
  input: UpdatePaymentLogInput;
}

export interface UpdatePaymentLogInput {
  uId?: string;
  status?: string;
}

export interface DeletePaymentLogArgs {
  id: number;
}

export interface MerchantArgs {
  where?: MerchantFilterInput;
}

// ── DTO 接口 ──

export interface PaymentLog {
  id: number;
  uId: string;
  status: string;
  createTime: string;
  isDeleted: boolean;
  tags?: string[];
  meta?: Record<string, string>;
  extra?: { nested: string; value: number };
}

export interface Merchant {
  id: number;
  name: string;
  balance: number;
  createdAt: string;
  status: string;
  children?: Merchant[];
}

// ── 过滤类型（OperationFilterInput 家族） ──

export interface PaymentLogFilterInput {
  and?: PaymentLogFilterInput | null;
  or?: PaymentLogFilterInput | null;
  id?: LongOperationFilterInput | null;
  uId?: StringOperationFilterInput | null;
  status?: EnumOperationFilterInput<string> | null;
  createTime?: DateTimeOperationFilterInput | null;
  isDeleted?: BooleanOperationFilterInput | null;
}

export interface PaymentLogSortInput {
  id?: SortEnumType;
  createTime?: SortEnumType;
}

export interface MerchantFilterInput {
  and?: MerchantFilterInput | null;
  or?: MerchantFilterInput | null;
  id?: LongOperationFilterInput | null;
  name?: StringOperationFilterInput | null;
  balance?: LongOperationFilterInput | null;
  status?: EnumOperationFilterInput<string> | null;
  createdAt?: DateTimeOperationFilterInput | null;
}

// ── Connection 类型别名（双类型参数） ──

export type PaymentLogConnection = Connection<PaymentLog, PaymentLogEdge>;
export type PaymentLogEdge = Edge<PaymentLog>;
export type MerchantConnection = Connection<Merchant, MerchantEdge>;
export type MerchantEdge = Edge<Merchant>;

// ── OperationFilterInput 家族定义 ──

export interface LongOperationFilterInput {
  eq?: number; neq?: number; gt?: number; gte?: number;
  lt?: number; lte?: number; in?: number; nin?: number;
  ngt?: number; ngte?: number; nlt?: number; nlte?: number;
}

export interface StringOperationFilterInput {
  eq?: string; neq?: string; contains?: string; ncontains?: string;
  startsWith?: string; nstartsWith?: string; endsWith?: string; nendsWith?: string;
  in?: string; nin?: string;
  and?: StringOperationFilterInput; or?: StringOperationFilterInput;
}

export interface BooleanOperationFilterInput {
  eq?: boolean; neq?: boolean;
}

export interface EnumOperationFilterInput<T extends string> {
  eq?: T; neq?: T; in?: T; nin?: T;
}

export interface DateTimeOperationFilterInput {
  eq?: string; neq?: string; gt?: string; gte?: string;
  lt?: string; lte?: string;
}

export type SortEnumType = "ASC" | "DESC";