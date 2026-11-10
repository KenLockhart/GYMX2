-- Creating a program failed for every coach: the insert asks for the new row back, and the read
-- rule only called can_view_program(id), which looks the program up by id and can't see a row
-- inserted in the same statement. Coaches now see their own programs straight from the row.
drop policy "Coaches, admins and their members see programs" on public.programs;
create policy "Coaches, admins and their members see programs"
on public.programs for select to authenticated
using (
  coach_id = (select auth.uid())
  or (select private.can_view_program(programs.id))
);
