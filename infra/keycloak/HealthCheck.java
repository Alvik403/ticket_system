public class HealthCheck {
  public static void main(String[] args) throws Exception {
    String url =
        args.length > 0 ? args[0] : "http://127.0.0.1:8080/realms/ticket-system";
    var connection =
        (java.net.HttpURLConnection)
            java.net.URI.create(url).toURL().openConnection();
    connection.setConnectTimeout(2000);
    connection.setReadTimeout(2000);
    int status = connection.getResponseCode();
    if (status != 200) {
      System.exit(1);
    }
  }
}
