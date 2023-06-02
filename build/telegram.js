import { config } from "dotenv";
config();
import TelegramBot from "node-telegram-bot-api";
let last_sent_tg = "";
let task_list_msg = "Tasks:";
const genTaskList = (tasks) => {
    return `*3 /tasks*

/t1 I am a task

/t2 I am another task`;
};
let sendListeners = [];
const token = process.env.TELEGRAM_KEY;
const owner = process.env.TELEGRAM_OWNER;
if (!token) {
    throw new Error("No TELEGRAM_KEY key found in environment variables!");
}
if (!owner) {
    throw new Error("No TELEGRAM_OWNER key found in environment variables!");
}
// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });
// Listen for any kind of message. There are different kinds of
// messages.
bot.on("message", async (msg) => {
    var _a, _b;
    if (((_a = msg.from) === null || _a === void 0 ? void 0 : _a.id) !== parseInt(owner)) {
        console.log("Not from owner! " + ((_b = msg.from) === null || _b === void 0 ? void 0 : _b.id) + ": " + (msg === null || msg === void 0 ? void 0 : msg.text));
        return;
    }
    const { text } = msg;
    console.log("C:", text);
    if (text === null || text === void 0 ? void 0 : text.startsWith("/")) {
        if (text === "/tasklist" ||
            text == "/t" ||
            text == "/tasks" ||
            text == "/start") {
            printTaskList();
            return;
        }
        if (text.startsWith("/t") && !text.startsWith("/ta")) {
            const taskNumber = text.slice(2);
            if (taskNumber === "") {
                return;
            }
            await sendThroughListener(taskNumber, "done");
            printTaskList();
            return;
        }
        return;
    }
    task_list_msg = genTaskList([]);
    // otherwise add it to the list
    await sendThroughListener(text || "", "add");
    // print task list
    printTaskList();
});
const sendThroughListener = async (message, method) => {
    // promise all
    await Promise.all(sendListeners.map((listener) => listener(message, method)));
};
const printTaskList = () => {
    // send with markdown2
    last_sent_tg = task_list_msg;
    bot.sendMessage(owner, task_list_msg, { parse_mode: "MarkdownV2" });
};
export const updateTaskList = async (newTaskList) => {
    task_list_msg = newTaskList;
    if (last_sent_tg !== task_list_msg) {
        printTaskList();
    }
};
export const registerSendListener = (listener) => {
    sendListeners.push(listener);
};
//# sourceMappingURL=telegram.js.map