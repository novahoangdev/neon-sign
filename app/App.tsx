import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NeonScene } from "./src/scene/NeonScene";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#07060b" }}>
      <StatusBar style="light" hidden />
      <NeonScene />
    </GestureHandlerRootView>
  );
}
