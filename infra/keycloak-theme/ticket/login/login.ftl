<#import "template.ftl" as layout>
<@layout.registrationLayout
  displayMessage=!messagesPerField.existsError("username", "password")
  displayInfo=false;
  section
>
  <#if section == "header">
    <div class="ticket-brand">
      <span class="ticket-eyebrow">Рабочее место</span>
      <div class="ticket-title">Электронная очередь</div>
      <p>Вход доступен только сотрудникам организации.</p>
    </div>
  <#elseif section == "form">
    <form
      id="kc-form-login"
      class="ticket-login-form"
      action="${url.loginAction}"
      method="post"
      onsubmit="login.disabled = true; return true;"
    >
      <div class="ticket-field">
        <label for="username">Логин</label>
        <input
          id="username"
          name="username"
          value="${(login.username!'')}"
          type="text"
          autofocus
          autocomplete="username"
          aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
        />
      </div>

      <div class="ticket-field">
        <label for="password">Пароль</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
        />
      </div>

      <#if messagesPerField.existsError("username", "password")>
        <div class="ticket-error" role="alert">
          ${kcSanitize(messagesPerField.getFirstError("username", "password"))?no_esc}
        </div>
      </#if>

      <#if realm.rememberMe>
        <label class="ticket-checkbox">
          <input
            id="rememberMe"
            name="rememberMe"
            type="checkbox"
            <#if login.rememberMe??>checked</#if>
          />
          <span>Запомнить меня</span>
        </label>
      </#if>

      <button id="kc-login" name="login" type="submit">Войти</button>
    </form>
  </#if>
</@layout.registrationLayout>

