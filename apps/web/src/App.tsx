import { JoinPage } from "./pages/JoinPage.js";
import { RoomPage } from "./pages/RoomPage.js";
import { useRoute } from "./router.js";

export function App() {
  const route = useRoute();
  if (route.page === "room") return <RoomPage key={route.code} code={route.code} />;
  return <JoinPage />;
}
