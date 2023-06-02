import dotenv from "dotenv";
dotenv.config();
import path from "path";
import process from "process";
import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import fs from "fs/promises";
import { LinearClient } from "@linear/sdk";
import moment from "moment";
import {
  updateTaskList as updateTaskList,
  registerSendListener,
} from "./telegram.js";

const credentials = path.join(process.cwd(), "credentials.json");

const scopes = ["https://www.googleapis.com/auth/tasks"];
const token = path.join(process.cwd(), "token.json");

let tokenExists = false;

// nextDay
const nextDay = () => {
  // 2 days from now, if that's a weekend, monday
  const twoDaysFromNow = moment().add(2, "days");
  if (twoDaysFromNow.day() === 0) {
    return moment().add(3, "days");
  }
  if (twoDaysFromNow.day() === 6) {
    return moment().add(4, "days");
  }
  return twoDaysFromNow;
};

// check token file
try {
  await fs.access(token);
  tokenExists = true;
} catch (err) {}

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

if (!LINEAR_API_KEY) {
  throw new Error("No LINEAR_API_KEY key found in environment variables!");
}

const linear = new LinearClient({ apiKey: LINEAR_API_KEY });

if (!tokenExists) {
  const auth = await authenticate({
    keyfilePath: credentials,
    scopes: scopes,
  });

  // persist to file
  await fs.writeFile(token, JSON.stringify(auth.credentials));
}

let tokenData = await fs.readFile(token, "utf-8");

// authorize automatically
const auth = new google.auth.OAuth2();
auth.setCredentials(JSON.parse(tokenData));

auth.on("tokens", (tokens) => {
  if (tokens.refresh_token) {
    console.log("New refresh token! Saving to file!");
    tokenData = JSON.stringify(tokens);
    // old token
    fs.writeFile(token, tokenData);
  }
});

const tasks = google.tasks({
  version: "v1",
  auth: auth,
});

const log = (...messages: string[]) => {
  const nowDate = moment.utc().format("YYYY-MM-DD HH:mm:ss");
  console.log(`[Linear sync ${nowDate}]`, ...messages);
};

registerSendListener(async (message, method) => {
  // method is the ID
  const tasklists = await tasks.tasklists.list();

  // pick task list named General
  const generalTaskList = tasklists?.data?.items?.find(
      (tasklist) => tasklist.title === "General"
    ),
    generalTaskListId = generalTaskList?.id;

  if (method == "add") {
    // new task
    // add a task with the message
    if (!generalTaskListId) {
      console.error("No General task list found!");
      return;
    }

    // title is the first line. if there are more than 1 line, its desc

    const title = message.split("\n")[0],
      desc = message.split("\n").slice(1).join("\n");

    await tasks.tasks.insert({
      tasklist: generalTaskListId,
      requestBody: {
        title: title + "",
        notes: desc,
        kind: "tasks#task",
        due: nextDay().format() + "",
      },
    });

    // send the tasklist again
    await updateTaskListInTelegram(generalTaskListId);

    return;
  }
  if (method == "done") {
    // done task

    if (!generalTaskListId) {
      console.error("No General task list found!");
      return;
    }

    // list all tasks in general
    const generalTasks = await tasks.tasks.list({
        tasklist: generalTaskListId,
      }),
      generalTasksData = generalTasks?.data?.items;

    // find one with the id
    const task = generalTasksData?.find((task) => task.id === message);

    if (!task) {
      console.error("No task found with ID " + message);
      return;
    }

    // mark as done
    await tasks.tasks.update({
      tasklist: generalTaskListId,
      task: method,
      requestBody: {
        ...task,
        status: "completed",
      },
    });
    // send the tasklist again
    await updateTaskListInTelegram(generalTaskListId);
    return;
  }
});

async function updateTaskListInTelegram(generalTaskListId: string) {
  const generalTasks = await tasks.tasks.list({
      tasklist: generalTaskListId,
    }),
    generalTasksData = generalTasks?.data?.items;

  // get not completed tasks
  const notCompletedTasks = generalTasksData?.filter(
    (task) => task.status !== "completed"
  );
  // generate task list
  const taskList = notCompletedTasks
    ?.map((task: any) => `${task.title}\n/t${task.id}`)
    .join("\n\n");

  // escape markdown in tasklist
  const escapeMarkdown = (text: string) => {
    // including dash
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  };

  updateTaskList(
    `*${notCompletedTasks?.length} /tasks*\n\n` + escapeMarkdown(taskList || "")
  );
}

async function task() {
  log("Starting task");
  const tasklists = await tasks.tasklists.list();

  // pick task list named General
  const generalTaskList = tasklists?.data?.items?.find(
      (tasklist) => tasklist.title === "General"
    ),
    generalTaskListId = generalTaskList?.id;

  log("General task has ID " + generalTaskListId);

  if (!generalTaskListId) {
    console.error("No General task list found!");
    return;
  }

  // list all tasks in general
  const generalTasks = await tasks.tasks.list({
      tasklist: generalTaskListId,
    }),
    generalTasksData = generalTasks?.data?.items;

  log(
    "Google - got " + generalTasksData?.length + " tasks in General task list"
  );

  const me = await linear.viewer;
  const myIssues = await me.assignedIssues();

  log("Linear - got " + myIssues.nodes.length + " issues assigned to me");

  const issues = myIssues.nodes
    .filter(
      (issue) =>
        // was updated in past 2 weeks
        moment(issue.updatedAt).isAfter(moment().subtract(2, "weeks")) &&
        // not snoozed
        !issue.snoozedBy &&
        // not done
        !issue?.completedAt
    )
    .map((issue) => ({
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      // set due date to 3 days from now if not set
      dueDate: issue.dueDate
        ? moment(issue.dueDate).format()
        : nextDay().format(),
    }));

  log("Linear - got " + issues.length + " issues after relevancy filter");

  const linearToCreate = issues.filter(
    // if there's a google task with identifier in the title, skip it
    (issue) =>
      !generalTasksData?.find((task) => task?.title?.includes(issue.identifier))
  );

  log("Linear - got " + linearToCreate.length + " issues to create");

  linearToCreate.forEach(async (issue) => {
    log("Creating task for " + issue.identifier);
    await tasks.tasks.insert({
      tasklist: generalTaskListId,
      requestBody: {
        title: `${issue.identifier} ${issue.title}`,
        due: issue.dueDate,
        notes: issue.url,
        kind: "tasks#task",
      },
    });
  });
  await updateTaskListInTelegram(generalTaskListId);
}

export const init = async () => {
  log("Starting linear-sync");
  await task();

  // every 10 minutes, run task
  setInterval(task, 10 * 60 * 1000);
};
