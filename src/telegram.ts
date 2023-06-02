import { config } from "dotenv";
config();
import TelegramBot from "node-telegram-bot-api";

let last_sent_tg = "";

let task_list_msg = "Tasks:";

const genTaskList = (tasks: string[]) => {
  return `*3 /tasks*

/t1 I am a task

/t2 I am another task`;
};

let sendListeners: ((message: string, method: string) => Promise<any>)[] = [];

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
  if (msg.from?.id !== parseInt(owner)) {
    console.log("Not from owner! " + msg.from?.id + ": " + msg?.text);
    return;
  }
  const { text } = msg;
  console.log("C:", text);

  if (text?.startsWith("/")) {
    if (
      text === "/tasklist" ||
      text == "/t" ||
      text == "/tasks" ||
      text == "/start"
    ) {
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

const sendThroughListener = async (message: string, method: string) => {
  // promise all
  await Promise.all(sendListeners.map((listener) => listener(message, method)));
};

const printTaskList = () => {
  // send with markdown2
  last_sent_tg = task_list_msg;
  bot.sendMessage(owner, task_list_msg, { parse_mode: "MarkdownV2" });
};

export const updateTaskList = async (newTaskList: string) => {
  task_list_msg = newTaskList;
  if (last_sent_tg !== task_list_msg) {
    printTaskList();
  }
};

export const registerSendListener = (
  listener: (message: string, method: string) => Promise<any>
) => {
  sendListeners.push(listener);
};
