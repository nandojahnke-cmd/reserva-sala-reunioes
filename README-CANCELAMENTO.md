# Atualizacao: cancelamento protegido por codigo

Esta atualizacao impede que qualquer pessoa cancele a reserva de outra pessoa sem autorizacao.

## O que mudou

- Ao criar uma reserva, a aplicacao gera automaticamente um codigo de cancelamento.
- O usuario pode clicar em **Gerar** para trocar o codigo antes de agendar.
- Para cancelar, a pessoa precisa informar o mesmo codigo.
- O codigo nao aparece na agenda.
- O Supabase guarda apenas um hash do codigo.
- O cancelamento direto pela tabela foi bloqueado para usuarios anonimos.
- A criacao e o cancelamento passam por funcoes seguras no Supabase.

## Como aplicar no Supabase

1. Abra seu projeto no Supabase.
2. Entre em **SQL Editor**.
3. Clique em **New query**.
4. Copie todo o conteudo do arquivo `supabase-schema.sql`.
5. Cole no editor.
6. Clique em **Run**.

## Como testar

1. Abra a aplicacao publicada.
2. Veja o codigo gerado no formulario.
3. Crie uma reserva.
4. Guarde o codigo exibido na mensagem de sucesso.
5. Abra a agenda em outro navegador.
6. Tente cancelar com codigo errado.
7. Confirme que o cancelamento e bloqueado.
8. Cancele com o codigo correto.

## Observacao

Reservas antigas criadas antes desta atualizacao podem nao ter codigo de cancelamento.
Para essas reservas, cancele manualmente pelo painel do Supabase ou recrie a reserva com codigo.
