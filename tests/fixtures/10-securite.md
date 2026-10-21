# Contenu hostile

<script>alert('xss')</script>

<img src=x onerror="alert('xss')">

[Lien javascript](javascript:alert('xss'))

[Lien data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

![Image piégée](javascript:alert(1))

<iframe src="https://evil.example"></iframe>

:::callout {title="<img src=x onerror=alert(1)>" type="info\" onmouseover=\"alert(1)"}
Attributs piégés.
:::

:::section {bg="red;background:url(https://evil.example/x)"}
Fond piégé.
:::

:::image {src="../../../../etc/passwd" alt="Traversée"}
:::

<style>body{display:none}</style>

Texte normal<br>avec un retour à la ligne.
