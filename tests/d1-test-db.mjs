import {DatabaseSync} from 'node:sqlite';
// Executes the real SQL with SQLite. batch has the same all-or-nothing contract as D1.
export function testDB(path=':memory:'){
  const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON');
  const execute=(sql,args)=>{const s=sqlite.prepare(sql);if(s.columns().length){const results=s.all(...args);return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}}}const meta=s.run(...args);return {results:[],meta:{changes:Number(meta.changes),last_row_id:Number(meta.lastInsertRowid)}}};
  const statement=(sql,args=[])=>({sql,args,bind(...next){return statement(sql,next)},async all(){return execute(sql,args)},async first(){return execute(sql,args).results[0]||null},async run(){return execute(sql,args)}});
  const DB={prepare:sql=>statement(sql),async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const values=statements.map(s=>execute(s.sql,s.args));sqlite.exec('COMMIT');return values}catch(e){sqlite.exec('ROLLBACK');throw e}}};
  return {DB,sqlite,close:()=>sqlite.close()};
}
