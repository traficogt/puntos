import { dbQuery } from "../database.js";

export async function one(sql, params = []) {
  const r = await dbQuery(sql, params);
  return r.rows[0] ?? null;
}

export async function many(sql, params = []) {
  const r = await dbQuery(sql, params);
  return r.rows;
}

export async function exec(sql, params = []) {
  return dbQuery(sql, params);
}
