begin;
select plan(8);

select hasnt_function('public', 'is_admin', 'is_admin is not in the API schema');
select hasnt_function('public', 'has_role', 'has_role is not in the API schema');
select hasnt_function('public', 'is_assigned_task', 'is_assigned_task is not in the API schema');
select hasnt_function('public', 'is_assigned_video', 'is_assigned_video is not in the API schema');

select has_function('private', 'is_admin', 'is_admin lives in private');
select has_function('private', 'has_role', 'has_role lives in private');

select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot reach the private schema'
);
select ok(
  has_function_privilege('authenticated', 'private.is_admin()', 'execute'),
  'signed-in users can still run is_admin inside policies'
);

select * from finish();
rollback;
