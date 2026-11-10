drop policy "Coaches, admins and their members see programs" on public.programs;
create policy "Coaches, admins and their members see programs"
on public.programs for select to authenticated
using ((select private.can_view_program(programs.id)));
