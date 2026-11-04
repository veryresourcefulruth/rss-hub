-- Local-only: a tiny Childcare 101 database so Ada Obi has completed training and Ben Lee hasn't.
INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES ('content','{"modules":[{"id":"m1"},{"id":"m2"}]}','2026-01-01');
INSERT OR REPLACE INTO trainees(id,name,name_key,pin_hash,created_at,declared_at) VALUES ('t1','Ada Obi','ada obi','x','2026-01-01','2026-01-02'),('t2','Ben Lee','ben lee','x','2026-01-01',NULL);
INSERT OR REPLACE INTO results(trainee_id,module_id,passed) VALUES ('t1','m1',1),('t1','m2',1),('t2','m1',1);
