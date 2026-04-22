import SwiftUI

struct LoginView: View {
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        Form {
            TextField("login.email", text: $email)
                .textInputAutocapitalization(.never)
            SecureField("login.password", text: $password)
            Button("login.submit") {}
        }
        .navigationTitle("login.title")
    }
}

#Preview {
    NavigationStack {
        LoginView()
    }
}

