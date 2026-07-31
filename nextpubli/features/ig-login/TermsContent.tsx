// Shared Terms of Use body — used by both the signup popup (IgSignupButton) and the
// standalone /termos page. The heading is added by each caller.
export function TermsContent() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-foreground-secondary">
      <p className="text-xs">Versão simplificada — última atualização: junho de 2026.</p>

      <section>
        <h3 className="text-base font-semibold text-foreground">
          1. O que é a NextPubli
        </h3>
        <p className="mt-1">
          A NextPubli conecta influenciadores a marcas parceiras. Ao criar sua conta com o
          Instagram, você passa a fazer parte da nossa rede e pode ganhar comissões
          divulgando produtos das marcas.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">
          2. Publicação no seu Instagram
        </h3>
        <p className="mt-1">
          Ao aceitar estes termos, você{" "}
          <strong>
            autoriza a NextPubli a publicar conteúdo na sua conta do Instagram em seu nome
          </strong>
          , incluindo <strong>stories, posts no feed, reels e carrosséis</strong>. As
          publicações são feitas em nome das marcas parceiras às quais você está
          associado. Você pode revisar e desconectar sua conta a qualquer momento.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">3. Comissões</h3>
        <p className="mt-1">
          Você ganha comissão recorrente por cada venda gerada pelo seu link de afiliado,
          conforme as condições de cada marca. Os pagamentos são feitos pela chave de
          recebimento que você cadastrar.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">
          4. Sua conta e seus dados
        </h3>
        <p className="mt-1">
          Para entrar, usamos sua conta profissional do Instagram. Também pedimos um email
          e WhatsApp para falar com você sobre campanhas e pagamentos. Seus dados são
          usados apenas para operar a plataforma.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">5. Cancelamento</h3>
        <p className="mt-1">
          Você pode desconectar seu Instagram e encerrar sua conta quando quiser. A partir
          daí, não publicaremos mais nada em seu nome.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">6. Observações</h3>
        <p className="mt-1">
          A NextPubli não é afiliada, patrocinada ou endossada pelo Instagram ou pela
          Meta. Estes termos podem ser atualizados; avisaremos sobre mudanças importantes.
        </p>
      </section>
    </div>
  );
}
