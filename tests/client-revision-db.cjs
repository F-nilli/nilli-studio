// Local PostgreSQL integration test; does not connect to production.
const { PGlite } = require('@electric-sql/pglite')
const fs = require('node:fs')
const assert = require('node:assert/strict')
async function main() {
 const db = new PGlite()
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
 CREATE TABLE users(id uuid PRIMARY KEY, role text);
 CREATE TABLE episodes(id uuid PRIMARY KEY, release_date date, release_time time);
 CREATE TABLE workspace_settings(timezone text);
 CREATE TABLE tasks(id uuid PRIMARY KEY, episode_id uuid, template_task_id int, label text, track text,
 status text, assignee_id uuid, approver_id uuid, requires_approval boolean, due_date timestamptz,
 due_days int, dep_task_ids uuid[] DEFAULT '{}', quantity int, brief text, note text, created_at timestamptz,
 review_started_at timestamptz, submission_count int DEFAULT 0);
 CREATE TABLE task_history(task_id uuid, episode_id uuid, from_status text, to_status text, changed_by uuid, note text);`)
 await db.exec(fs.readFileSync('supabase/migration_client_revision_rounds.sql','utf8'))
 await db.exec(fs.readFileSync('supabase/migration_task_submission_count.sql','utf8'))
 await db.exec(`CREATE TRIGGER trg_guard_task_update BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION guard_task_update();
 CREATE TRIGGER trg_unlock_dependent_tasks AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION unlock_dependent_tasks();`)
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
 const actor=id(1), reviewer=id(2), ep=id(3), parent=id(4), a=id(5), b=id(6)
 await db.query("INSERT INTO users VALUES ($1,'member'),($2,'member')",[actor,reviewer])
 await db.query("INSERT INTO episodes VALUES ($1,'2026-10-01','09:00')",[ep])
 for(const child of [a,b])await db.query("INSERT INTO tasks(id,episode_id,status,assignee_id,approver_id,requires_approval,track,label) VALUES($1,$2,'done',$3,$4,true,'Long-form','Edit')",[child,ep,actor,reviewer])
 await db.query("INSERT INTO tasks(id,episode_id,status,assignee_id,track,dep_task_ids) VALUES($1,$2,'in_progress',$3,'Client Action',$4)",[parent,ep,actor,[a,b]])
 await db.query("SELECT start_client_revision_round($1,$2,now(),$3)",[parent,[a,b],actor])
 const status=async task=>(await db.query('SELECT status FROM tasks WHERE id=$1',[task])).rows[0].status
 assert.equal(await status(parent),'locked')
 await db.query("SELECT set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', false)")
 await db.query("SELECT set_config('test.actor',$1,false)",[actor])
 await assert.rejects(db.query('UPDATE tasks SET client_revision_parent_id=NULL WHERE id=$1',[a]))
 await db.query("UPDATE tasks SET status='done' WHERE id=$1",[a])
 assert.equal(await status(parent),'locked')
 await db.query("UPDATE tasks SET status='done' WHERE id=$1",[b])
 assert.equal(await status(parent),'done')
 await db.query("UPDATE tasks SET status='in_progress' WHERE id=$1",[b])
 assert.equal(await status(parent),'locked')
 // The next internal review decision clears the old client origin.
 await db.query("UPDATE tasks SET status='in_review' WHERE id=$1",[b])
 await db.query("SELECT set_config('test.actor',$1,false)",[reviewer])
 await db.query("UPDATE tasks SET status='revision' WHERE id=$1",[b])
 assert.equal((await db.query('SELECT client_revision_parent_id FROM tasks WHERE id=$1',[b])).rows[0].client_revision_parent_id,null)
 await db.query("SELECT set_config('test.actor',$1,false)",[actor])
 await assert.rejects(db.query("UPDATE tasks SET status='done' WHERE id=$1",[b]))
 await db.query("UPDATE tasks SET status='in_review' WHERE id=$1",[b])
 assert.equal(await status(b),'in_review')
 await db.close()
 console.log('Database integration passed: round creation, partial/final completion, undo, protected origin, and internal review routing.')
}
main().catch(e=>{console.error(e);process.exitCode=1})
