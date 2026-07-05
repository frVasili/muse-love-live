'use strict';

var discord_js = require('discord.js');

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var defaultOptions = {
  firstEmoji: "\u23EA",
  prevEmoji: "\u25C0\uFE0F",
  nextEmoji: "\u25B6\uFE0F",
  lastEmoji: "\u23ED",
  firstLabel: "",
  prevLabel: "",
  nextLabel: "",
  lastLabel: "",
  limit: 5,
  idle: 5 * 60 * 1e3,
  ephemeral: false,
  prevDescription: "",
  postDescription: "",
  attachments: [],
  contents: [],
  buttonStyle: discord_js.ButtonStyle.Secondary,
  loop: false
};

// src/lib/types/Options.ts
var ExtraRowPosition = /* @__PURE__ */ ((ExtraRowPosition2) => {
  ExtraRowPosition2[ExtraRowPosition2["Above"] = 0] = "Above";
  ExtraRowPosition2[ExtraRowPosition2["Below"] = 1] = "Below";
  return ExtraRowPosition2;
})(ExtraRowPosition || {});

// src/lib/pagination/PaginationEmbed.ts
var _PaginationEmbed = class _PaginationEmbed extends discord_js.EmbedBuilder {
  /**
   * @param options - The pagination options
   * @example
   * ```javascript
   * const pagination = new PaginationEmbed({
   *  firstEmoji: "⏮",
   *  prevEmoji: "◀️",
   *  nextEmoji: "▶️",
   *  lastEmoji: "⏭",
   *  limit: 5,
   *  idle: 5 * 60 * 1000,
   *  ephemeral: false,
   *  prevDescription: "",
   *  postDescription: "",
   *  attachments: [],
   *  buttonStyle: ButtonStyle.Secondary,
   *  loop: false,
   * });
   * ```
   */
  constructor(options = {}) {
    super();
    /**
     * Pagination button infos.
     *
     * @readonly
     * @defaultValue `defaultOptions.buttonInfo`
     */
    __publicField(this, "buttonInfo");
    /**
     * The images to paginate through.
     */
    __publicField(this, "images");
    /**
     * The descriptions to paginate through.
     */
    __publicField(this, "descriptions");
    /**
     * The action rows of the final message.
     */
    __publicField(this, "actionRows");
    /**
     * The total number of entries.
     */
    __publicField(this, "totalEntry");
    /**
     * The total number of pages.
     */
    __publicField(this, "totalPages");
    /**
     * The current page number.
     */
    __publicField(this, "currentPage");
    /**
     * The limit of entries per page.
     *
     * @defaultValue 5
     */
    __publicField(this, "limit");
    /**
     * The idle time before closing.
     *
     * @defaultValue 5 * 60 * 1_000
     */
    __publicField(this, "idle");
    /**
     * Whether the reply should be ephemeral or not.
     *
     * @defaultValue false
     */
    __publicField(this, "ephemeral");
    /**
     * The description to show before the paginated descriptions.
     *
     * @defaultValue ""
     */
    __publicField(this, "prevDescription");
    /**
     * The description to show after the paginated descriptions.
     *
     * @defaultValue ""
     */
    __publicField(this, "postDescription");
    /**
     * Whether to loop through the pages or not.
     *
     * @defaultValue false
     */
    __publicField(this, "loop");
    /**
     * The embeds if paginating through embeds.
     *
     * @defaultValue []
     */
    __publicField(this, "embeds");
    /**
     * The attachments to show with the paginated messages.
     *
     * @defaultValue []
     */
    __publicField(this, "attachments");
    /**
     * Whether if paginating through embed's fields.
     *
     * @defaultValue false
     */
    __publicField(this, "fieldPaginate");
    /**
     * The pagination buttons.
     */
    __publicField(this, "buttons");
    /**
     * Contents if changing contents per page.
     *
     * @defaultValue []
     */
    __publicField(this, "contents");
    /**
     * The payload of the final message.
     *
     * @readonly
     */
    __publicField(this, "payload");
    /**
     * Whether the footer is a custom footer or not.
     *
     */
    __publicField(this, "customFooter");
    /**
     * The main action row.
     *
     * @readonly
     */
    __publicField(this, "mainActionRow");
    /**
     * All the fields if paginating through fields.
     */
    __publicField(this, "rawFields");
    /**
     * The extra action rows to add, if any.
     *
     * @defaultValue []
     */
    __publicField(this, "extraRows");
    /**
     * The raw footer text.
     *
     */
    __publicField(this, "rawFooter");
    /**
     * Changed default buttons
     *
     */
    __publicField(this, "changedButtons");
    const mergedOptions = { ...defaultOptions, ...options };
    this.buttonInfo = {
      first: {
        emoji: mergedOptions.firstEmoji,
        label: mergedOptions.firstLabel,
        style: mergedOptions.buttonStyle
      },
      prev: {
        emoji: mergedOptions.prevEmoji,
        label: mergedOptions.prevLabel,
        style: mergedOptions.buttonStyle
      },
      next: {
        emoji: mergedOptions.nextEmoji,
        label: mergedOptions.nextLabel,
        style: mergedOptions.buttonStyle
      },
      last: {
        emoji: mergedOptions.lastEmoji,
        label: mergedOptions.lastLabel,
        style: mergedOptions.buttonStyle
      }
    };
    this.images = [];
    this.descriptions = [];
    this.embeds = [];
    this.actionRows = [];
    this.payload = {};
    this.totalEntry = 0;
    this.totalPages = 0;
    this.currentPage = 1;
    this.customFooter = true;
    this.rawFields = [];
    this.mainActionRow = new discord_js.ActionRowBuilder();
    this.extraRows = [];
    this.setOptions(mergedOptions);
  }
  /**
   * Appends fields to the embed
   *
   * @remarks
   * This method accepts either an array of fields or a variable number of field parameters.
   * The maximum amount of fields that can be added is 25.
   * @example
   * Using an array
   * ```ts
   * const fields: APIEmbedField[] = ...;
   * const pagination = new Pagination(interaction)
   * 	.addFields(fields);
   * ```
   * @example
   * Using rest parameters (variadic)
   * ```ts
   * const pagination = new Pagination(interaction)
   * 	.addFields(
   * 		{ name: 'Field 1', value: 'Value 1' },
   * 		{ name: 'Field 2', value: 'Value 2' },
   * 	);
   * ```
   * @param fields - The fields to add
   */
  addFields(...fields) {
    this.rawFields.push(...discord_js.normalizeArray(fields));
    return this;
  }
  /**
   * Removes, replaces, or inserts fields in the embed.
   *
   * @remarks
   * This method behaves similarly
   * to {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice | Array.prototype.splice}.
   * The maximum amount of fields that can be added is 25.
   *
   * It's useful for modifying and adjusting order of the already-existing fields of an embed.
   * @example
   * Remove the first field
   * ```ts
   * pagination.spliceFields(0, 1);
   * ```
   * @example
   * Remove the first n fields
   * ```ts
   * const n = 4
   * pagination.spliceFields(0, n);
   * ```
   * @example
   * Remove the last field
   * ```ts
   * pagination.spliceFields(-1, 1);
   * ```
   * @param index - The index to start at
   * @param deleteCount - The number of fields to remove
   * @param fields - The replacing field objects
   */
  spliceFields(index, deleteCount, ...fields) {
    if (this.data.fields) this.data.fields.splice(index, deleteCount, ...fields);
    else this.data.fields = fields;
    return this;
  }
  /**
   * Sets the embed's fields
   *
   * @remarks
   * This method is an alias for {@link PaginationEmbed.spliceFields}. More specifically,
   * it splices the entire array of fields, replacing them with the provided fields.
   *
   * You can set a maximum of 25 fields.
   * @param fields - The fields to set
   */
  setFields(...fields) {
    this.rawFields = discord_js.normalizeArray(fields);
    return this;
  }
  /**
   * Sets the pagination options.
   *
   * @param options - The pagination options
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setOptions({
   *    firstEmoji: "⏮",
   *    prevEmoji: "◀️",
   *    nextEmoji: "▶️",
   *    lastEmoji: "⏭",
   *    limit: 5,
   *    idle: 5 * 60 * 1000,
   *    ephemeral: false,
   *    prevDescription: "",
   *    postDescription: "",
   *    attachments: [],
   *    buttonStyle: ButtonStyle.Secondary,
   *    loop: false,
   *  });
   * ```
   */
  setOptions(options) {
    this.setEmojis({
      firstEmoji: options.firstEmoji,
      prevEmoji: options.prevEmoji,
      nextEmoji: options.nextEmoji,
      lastEmoji: options.lastEmoji
    });
    if (options.buttonStyle) this.setStyle(options.buttonStyle);
    this.setLabels({
      firstLabel: options.firstLabel,
      prevLabel: options.prevLabel,
      nextLabel: options.nextLabel,
      lastLabel: options.lastLabel
    });
    this.limit = options.limit ?? this.limit;
    this.idle = options.idle ?? this.idle;
    this.ephemeral = options.ephemeral ?? this.ephemeral;
    this.loop = options.loop ?? this.loop;
    this.prevDescription = typeof options.prevDescription === "string" ? options.prevDescription : this.prevDescription;
    this.postDescription = typeof options.postDescription === "string" ? options.postDescription : this.postDescription;
    this.attachments = options.attachments ?? this.attachments;
    this.contents = options.contents ?? this.contents;
    this.setButtons();
    return this;
  }
  /**
   * Sets the pagination images.
   *
   * @param images - The images to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setImages(["1st image", "2nd image", "3rd image"]);
   * ```
   */
  setImages(...images) {
    this.images = discord_js.normalizeArray(images);
    return this;
  }
  /**
   * Adds multiple pagination images.
   *
   * @param images - The images to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setImages(["1st image", "2nd image", "3rd image"])
   *  .addImages(["4st image", "5nd image", "6rd image"]);
   * ```
   */
  addImages(...images) {
    this.images.push(...discord_js.normalizeArray(images));
    return this;
  }
  /**
   * Sets the pagination descriptions.
   *
   * @param descriptions - The descriptions to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setDescriptions(["1st description", "2nd description", "3rd description"]);
   * ```
   */
  setDescriptions(...descriptions) {
    this.descriptions = discord_js.normalizeArray(descriptions);
    return this;
  }
  /**
   * Adds multiple pagination descriptions.
   *
   * @param descriptions - The descriptions to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setDescriptions(["1st description", "2nd description", "3rd description"])
   *  .addDescriptions(["4st description", "5nd description", "6rd description"]);
   * ```
   */
  addDescriptions(...descriptions) {
    this.descriptions.push(...discord_js.normalizeArray(descriptions));
    return this;
  }
  /**
   * Sets the pagination embeds.
   * Note: if you set this then all other pagination methods and embed methods will be ignored
   * i.e., descriptions, images, fields, also the embed properties like title, footer and all
   *
   * @param embeds - The embeds to set
   * @param template - A template function that will be called for each embed.
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setEmbeds([new EmbedBuilder(), new EmbedBuilder(), new EmbedBuilder()]);
   * ```
   */
  setEmbeds(embeds, template) {
    if (template)
      embeds = embeds.map((embed, index, array) => template(embed instanceof discord_js.EmbedBuilder ? embed : discord_js.EmbedBuilder.from(embed), index, array));
    this.embeds = embeds;
    this.limit = 1;
    return this;
  }
  /**
   * Adds multiple pagination embeds.
   *
   * @param embeds - An array of [EmbedBuilder](https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder)
   *  or [APIEmbed](https://discord-api-types.dev/api/discord-api-types-v10/interface/APIEmbed)
   * @param template - A template function that will be called for each embed.
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setEmbeds([new EmbedBuilder(), new EmbedBuilder(), new EmbedBuilder()])
   *  .addEmbeds([new EmbedBuilder(), new EmbedBuilder(), new EmbedBuilder()]);
   * ```
   */
  addEmbeds(embeds, template) {
    if (template) embeds = embeds.map((embed) => template(discord_js.EmbedBuilder.from(embed)));
    this.embeds.push(...embeds);
    return this;
  }
  /**
   * Paginates through fields.
   * It will be ignored if you are not paginating through fields.
   *
   * @param paginate - Whether to paginate fields
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setFields([{
   *    name: "Field 1",
   *    value: "Field 1 value",
   *  },
   *  {
   *    name: "Field 2",
   *    value: "Field 2 value",
   *  }])
   *  .paginateFields();
   * ```
   */
  paginateFields(paginate = true) {
    this.fieldPaginate = paginate;
    return this;
  }
  /**
   * Sets the idle time before closing for the pagination.
   *
   * @param idle - The idle time
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setIdle(5 * 60 * 1000);
   * ```
   */
  setIdle(idle) {
    this.idle = idle;
    return this;
  }
  /**
   * Set whether the pagination reply should be ephemeral or not.
   *
   * @param ephemeral - Whether the reply should be ephemeral
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setEphemeral(true);
   * ```
   */
  setEphemeral(ephemeral = true) {
    this.ephemeral = ephemeral;
    return this;
  }
  /**
   * Sets the limit of entries per page for pagination.
   *
   * @param limit - Limit of entries per page
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setLimit(5);
   * ```
   */
  setLimit(limit) {
    this.limit = limit;
    return this;
  }
  /**
   * Sets a fixed prev description which will be shown in all pages before the paginated descriptions.
   * It will be ignored if you are not paginating through descriptions.
   *
   * @param prevDescription - The prev description to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setPrevDescription("role info");
   * ```
   */
  setPrevDescription(prevDescription) {
    this.prevDescription = prevDescription;
    return this;
  }
  /**
   * Sets a fixed post description which will be shown in all pages after the paginated descriptions.
   * It will be ignored if you are not paginating through descriptions.
   *
   * @param postDescription - The post description to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setPostDescription("role id: 123456789");
   * ```
   */
  setPostDescription(postDescription) {
    this.postDescription = postDescription;
    return this;
  }
  /**
   * Sets the emojis for the buttons.
   *
   * @param emojiOptions - The emoji options to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setEmojis({
   *    firstEmoji: ":first_emoji:",
   *    prevEmoji: ":prev_emoji:",
   *    nextEmoji: ":next_emoji:",
   *    lastEmoji: ":last_emoji:"
   *  });
   * ```
   */
  setEmojis(emojiOptions) {
    this.buttonInfo.first.emoji = emojiOptions.firstEmoji ?? this.buttonInfo.first.emoji;
    this.buttonInfo.prev.emoji = emojiOptions.prevEmoji ?? this.buttonInfo.prev.emoji;
    this.buttonInfo.next.emoji = emojiOptions.nextEmoji ?? this.buttonInfo.next.emoji;
    this.buttonInfo.last.emoji = emojiOptions.lastEmoji ?? this.buttonInfo.last.emoji;
    return this;
  }
  /**
   * Sets the labels for the buttons.
   *
   * @param labelOptions - The label options to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setLabels({
   *    firstLabel: "first",
   *    prevLabel: "prev",
   *    nextLabel: "next",
   *    lastLabel: "last"
   *  });
   * ```
   */
  setLabels(labelOptions) {
    this.buttonInfo.first.label = labelOptions.firstLabel ?? this.buttonInfo.first.label;
    this.buttonInfo.prev.label = labelOptions.prevLabel ?? this.buttonInfo.prev.label;
    this.buttonInfo.next.label = labelOptions.nextLabel ?? this.buttonInfo.next.label;
    this.buttonInfo.last.label = labelOptions.lastLabel ?? this.buttonInfo.last.label;
    return this;
  }
  /**
   * Sets the buttons' style.
   *
   * @param style - The style of the buttons
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setStyle(ButtonStyle.Secondary);
   * ```
   */
  setStyle(style) {
    this.buttonInfo.first.style = style;
    this.buttonInfo.prev.style = style;
    this.buttonInfo.next.style = style;
    this.buttonInfo.last.style = style;
    return this;
  }
  /**
   * Customizes the styles of each button.
   *
   * @param options - The styles of the buttons
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setButtonAppearance({
   *    first: {
   *      label: "First",
   *      emoji: ":first_emoji:",
   *      style: ButtonStyle.Secondary
   *    }
   *  });
   * ```
   */
  setButtonAppearance(options) {
    const { first, prev, next, last } = options;
    this.buttonInfo.first.label = first.label ?? this.buttonInfo.first.label;
    this.buttonInfo.prev.label = prev.label ?? this.buttonInfo.prev.label;
    this.buttonInfo.next.label = next.label ?? this.buttonInfo.next.label;
    this.buttonInfo.last.label = last.label ?? this.buttonInfo.last.label;
    this.buttonInfo.first.emoji = first.emoji ?? this.buttonInfo.first.emoji;
    this.buttonInfo.prev.emoji = prev.emoji ?? this.buttonInfo.prev.emoji;
    this.buttonInfo.next.emoji = next.emoji ?? this.buttonInfo.next.emoji;
    this.buttonInfo.last.emoji = last.emoji ?? this.buttonInfo.last.emoji;
    this.buttonInfo.first.style = first.style ?? this.buttonInfo.first.style;
    this.buttonInfo.prev.style = prev.style ?? this.buttonInfo.prev.style;
    this.buttonInfo.next.style = next.style ?? this.buttonInfo.next.style;
    this.buttonInfo.last.style = last.style ?? this.buttonInfo.last.style;
    return this;
  }
  /**
   * Set pagination buttons
   *
   * @param buttons - The buttons to set
   */
  setButtons(buttons) {
    if (buttons) this.changedButtons = true;
    this.buttons = buttons ?? {
      first: new discord_js.ButtonBuilder().setCustomId("paginate-first"),
      prev: new discord_js.ButtonBuilder().setCustomId("paginate-prev"),
      next: new discord_js.ButtonBuilder().setCustomId("paginate-next"),
      last: new discord_js.ButtonBuilder().setCustomId("paginate-last")
    };
    return this;
  }
  /**
   * Adds a custom action row below or above the pagination button action row.
   *
   * @param actionRows - The action rows to add
   * @param position - The position where the action rows to be added
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .addActionRows([new ActionRowBuilder()], ExtraRowPosition.Below);
   * ```
   */
  addActionRows(actionRows, position = 1 /* Below */) {
    this.extraRows.push({
      rows: actionRows,
      position
    });
    return this;
  }
  /**
   * Sends an attachment along with the embed.
   *
   * @param attachments - The attachments to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setAttachments([new AttachmentBuilder()]);
   * ```
   */
  setAttachments(attachments) {
    this.attachments = attachments;
    return this;
  }
  /**
   * Adds an attachment to the existing attachments.
   *
   * @param attachment - The attachment to add
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setAttachments([new AttachmentBuilder()])
   *  .addAttachment(new AttachmentBuilder());
   * ```
   */
  addAttachment(attachment) {
    this.attachments.push(attachment);
    return this;
  }
  /**
   * Adds multiple attachments to the existing attachments.
   *
   * @param attachments - The attachments to add
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setAttachments([new AttachmentBuilder()])
   *  .addAttachments([new AttachmentBuilder(), new AttachmentBuilder()]);
   * ```
   */
  addAttachments(attachments) {
    this.attachments.push(...attachments);
    return this;
  }
  /**
   * Triggers the pagination to go to a specific page.
   *
   * @param pageNumber - The page number to jump to
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setLimit(1)
   *  .setDescriptions(["1st page", "2nd page", "3rd page", "4th page", "5th page"]);
   * ...
   * pagination.goToPage(2);
   * ```
   */
  goToPage(pageNumber) {
    if (pageNumber < 1) pageNumber = this.totalPages;
    if (pageNumber > this.totalPages) pageNumber = 1;
    this.currentPage = pageNumber;
    if (this.embeds.length) {
      const embed = this.embeds[this.currentPage - 1];
      this.payload.embeds = [discord_js.EmbedBuilder.from(embed)];
      return this;
    }
    if (!this.data.footer) {
      this.customFooter = false;
      this.rawFooter = "Pages: {pageNumber}/{totalPages}";
    } else if (this.customFooter && !this.rawFooter) this.rawFooter = this.data.footer.text;
    this.setFooter({
      text: this.rawFooter.replaceAll("{pageNumber}", `${pageNumber}`).replaceAll("{totalPages}", `${this.totalPages}`),
      iconURL: this.data.footer?.icon_url
    });
    if (this.images.length) this.setImage(this.images[pageNumber - 1]);
    this.payload.content = (Array.isArray(this.contents) ? this.contents[this.currentPage - 1] : this.contents) ?? void 0;
    if (this.descriptions.length) {
      this.setDescription(
        `${this.prevDescription}
${this.descriptions.slice(pageNumber * this.limit - this.limit, pageNumber * this.limit).join("\n")}
${this.postDescription}`
      );
    }
    if (this.fieldPaginate) super.setFields(this.rawFields.slice(pageNumber * this.limit - this.limit, pageNumber * this.limit));
    return this;
  }
  /**
   * Sends contents along with the embed.
   *
   * @param contents - The contents to send.
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setContents(["this is the first page", "this is the second page"]);
   * ```
   */
  setContents(contents) {
    this.contents = contents;
    return this;
  }
  /**
   * Prepares the pagination.
   *
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.ready();
   * ```
   */
  ready() {
    if (!this.fieldPaginate) this.setFields(this.rawFields);
    this.totalEntry = this.embeds.length || Math.max(this.descriptions.length, this.images.length, this.fieldPaginate ? this.rawFields.length : 0);
    this.totalPages = Math.ceil(this.totalEntry / this.limit);
    this._readyPayloads();
    this.goToPage(this.currentPage);
    return this.payload;
  }
  /**
   * Goes to the first page.
   *
   * @param interaction - The interaction to reply to
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.goFirst(i);
   * ```
   */
  async goFirst(interaction) {
    this.currentPage = 1;
    if (!this.loop) {
      this.buttons.first?.setDisabled();
      this.buttons.prev?.setDisabled();
    }
    this.buttons.next?.setDisabled(false);
    this.buttons.last?.setDisabled(false);
    this.goToPage(1);
    await interaction.update(this.payload);
  }
  /**
   * Goes to the previous page.
   *
   * @param interaction - The interaction to reply to
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.goPrev(i);
   * ```
   */
  async goPrev(interaction) {
    this.currentPage--;
    if (!this.loop) {
      this.buttons.first?.setDisabled(this.currentPage === 1);
      this.buttons.prev?.setDisabled(this.currentPage === 1);
    }
    this.buttons.next?.setDisabled(false);
    this.buttons.last?.setDisabled(false);
    this.goToPage(this.currentPage);
    await interaction.update(this.payload);
  }
  /**
   * Goes to the next page.
   *
   * @param interaction - The interaction to reply to
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.goNext(i);
   * ```
   */
  async goNext(interaction) {
    this.currentPage++;
    this.buttons.prev?.setDisabled(false);
    this.buttons.first?.setDisabled(false);
    if (!this.loop) {
      this.buttons.next?.setDisabled(this.currentPage === Math.ceil(this.totalEntry / this.limit));
      this.buttons.last?.setDisabled(this.currentPage === Math.ceil(this.totalEntry / this.limit));
    }
    this.goToPage(this.currentPage);
    await interaction.update(this.payload);
  }
  /**
   * Goes to the last page.
   *
   * @param interaction - The interaction to reply to
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.goLast(i);
   * ```
   */
  async goLast(interaction) {
    this.currentPage = Math.ceil(this.totalEntry / this.limit);
    this.buttons.prev?.setDisabled(false);
    this.buttons.first?.setDisabled(false);
    if (!this.loop) {
      this.buttons.next?.setDisabled();
      this.buttons.last?.setDisabled();
    }
    this.goToPage(this.currentPage);
    await interaction.update(this.payload);
  }
  _readyButton(button, label, emoji, style) {
    if (!button) return this;
    if (label) button.setLabel(label);
    if (emoji) button.setEmoji(emoji);
    button.setStyle(style);
    return this;
  }
  /**
   * Prepare the message's action rows for pagination.
   *
   * @returns
   */
  _readyActionRows() {
    if (!this.changedButtons) {
      this._readyButton(this.buttons.first, this.buttonInfo.first.label, this.buttonInfo.first.emoji, this.buttonInfo.first.style);
      this._readyButton(this.buttons.prev, this.buttonInfo.prev.label, this.buttonInfo.prev.emoji, this.buttonInfo.prev.style);
      this._readyButton(this.buttons.next, this.buttonInfo.next.label, this.buttonInfo.next.emoji, this.buttonInfo.next.style);
      this._readyButton(this.buttons.last, this.buttonInfo.last.label, this.buttonInfo.last.emoji, this.buttonInfo.last.style);
    }
    this.buttons.first?.setDisabled();
    this.buttons.prev?.setDisabled();
    this.buttons.next?.setDisabled();
    this.buttons.last?.setDisabled();
    if (this.totalEntry > this.limit) {
      this.buttons.last?.setDisabled(false);
      this.buttons.next?.setDisabled(false);
    }
    if (this.loop && this.totalEntry > this.limit) {
      this.buttons.first?.setDisabled(false);
      this.buttons.prev?.setDisabled(false);
    }
    this.mainActionRow.setComponents(Object.values(this.buttons));
    this.actionRows = [this.mainActionRow];
    if (this.extraRows.length > 0) {
      for (const row of this.extraRows) {
        if (row.position === 0 /* Above */) this.actionRows.unshift(...row.rows);
        else this.actionRows.push(...row.rows);
      }
    }
    return this;
  }
  /**
   * Prepare the message's payload.
   */
  _readyPayloads() {
    this._readyActionRows();
    this.payload.flags = this.ephemeral ? discord_js.MessageFlags.Ephemeral : void 0;
    this.payload.components = this.actionRows;
    this.payload.content = (Array.isArray(this.contents) ? this.contents[0] : this.contents) ?? void 0;
    const embed = this.embeds.length ? discord_js.EmbedBuilder.from(this.embeds[0]) : this;
    this.payload.embeds = [embed];
    this.payload.files = this.attachments;
    return this.payload;
  }
};
__name(_PaginationEmbed, "PaginationEmbed");
var PaginationEmbed = _PaginationEmbed;

// src/lib/utils/util.ts
var authorOrUser = /* @__PURE__ */ __name((messageOrInteraction) => "user" in messageOrInteraction ? messageOrInteraction.user : messageOrInteraction.author, "authorOrUser");

// src/lib/pagination/Pagination.ts
var _Pagination = class _Pagination extends PaginationEmbed {
  // #end region
  /**
   * @param messageOrInteraction - The message or interaction to reply with the pagination message
   * @param options - The pagination options
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction, {
   *  firstEmoji: "⏮",
   *  prevEmoji: "◀️",
   *  nextEmoji: "▶️",
   *  lastEmoji: "⏭",
   *  limit: 5,
   *  idle: 5 * 60 * 1000,
   *  ephemeral: false,
   *  prevDescription: "",
   *  postDescription: "",
   *  attachments: [],
   *  buttonStyle: "SECONDARY",
   *  loop: false,
   * });
   * ```
   */
  constructor(messageOrInteraction, options = {}) {
    super(options);
    // #region public fields
    /**
     * The interaction that the paginator is for.
     *
     * @readonly
     */
    __publicField(this, "interaction");
    /**
     * All the authorized users who can use the pagination buttons
     */
    __publicField(this, "authorizedUsers");
    /**
     * The collector of the pagination.
     */
    __publicField(this, "collector");
    if (!(messageOrInteraction instanceof discord_js.BaseInteraction) && !(messageOrInteraction instanceof discord_js.Message)) {
      console.warn(
        `[pagination.djs] warn - The interaction must be an instance of Interaction or Message, received + ${// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        messageOrInteraction ? messageOrInteraction.construction?.name ?? messageOrInteraction.name ?? typeof messageOrInteraction : typeof messageOrInteraction}
For more information, see: https://github.com/imranbarbhuiya/pagination.djs/issues/68 or https://github.com/imranbarbhuiya/pagination.djs/issues/88`
      );
    }
    this.interaction = messageOrInteraction;
    this.authorizedUsers = [authorOrUser(messageOrInteraction).id];
  }
  // #region authorized users related
  /**
   * Sets authorized users who can use these pagination buttons.
   * Leave it a empty array to allow everyone to use the pagination.
   *
   * @param authorizedUsers - The users to set
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .setAuthorizedUsers([userId1, userId2, userId3]);
   * ```
   */
  setAuthorizedUsers(authorizedUsers) {
    this.authorizedUsers = authorizedUsers;
    return this;
  }
  /**
   * Adds a authorized user who can use these pagination buttons.
   *
   * @param authorizedUser - The user to add
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .addAuthorizedUser(userId1);
   * ```
   */
  addAuthorizedUser(authorizedUser) {
    this.authorizedUsers.push(authorizedUser);
    return this;
  }
  /**
   * Adds multiple authorized users who can use these pagination buttons.
   *
   * @param authorizedUsers - The users to add
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction)
   *  .addAuthorizedUsers([userId1, userId2, userId3]);
   * ```
   */
  addAuthorizedUsers(authorizedUsers) {
    this.authorizedUsers.push(...authorizedUsers);
    return this;
  }
  // #end region
  /**
   * Makes the pagination interactive.
   *
   * @param message - The message to listen for interactions
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.paginate(message);
   * ```
   */
  paginate(message) {
    this.collector = message.createMessageComponentCollector({
      filter: /* @__PURE__ */ __name(({ customId, user }) => ["first", "prev", "next", "last"].some((position) => this.buttons[position]?.data.custom_id === customId) && (this.authorizedUsers.length ? this.authorizedUsers.includes(user.id) : true), "filter"),
      idle: this.idle,
      componentType: discord_js.ComponentType.Button
    });
    this.collector.on("collect", async (interaction) => {
      if (interaction.customId === this.buttons.first?.data.custom_id) {
        await this.goFirst(interaction);
        return;
      }
      if (interaction.customId === this.buttons.prev?.data.custom_id) {
        await this.goPrev(interaction);
        return;
      }
      if (interaction.customId === this.buttons.next?.data.custom_id) {
        await this.goNext(interaction);
        return;
      }
      if (interaction.customId === this.buttons.last?.data.custom_id) await this.goLast(interaction);
    });
    return this;
  }
  /**
   * Sends the final message.
   * By default, it will send as a reply to the message
   * but if the interaction is already replied or deferred then it will `editReply`.
   * If you want to send follow-up or update the interaction, then use {@link Pagination.followUp} or {@link Pagination.update} instead.
   *
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.render();
   * ```
   */
  async render() {
    if (this.interaction instanceof discord_js.BaseInteraction && (this.interaction.replied || this.interaction.deferred)) return this.editReply();
    return this.reply();
  }
  /**
   * Replies the final message.
   *
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.reply();
   * ```
   */
  async reply() {
    const payload = this.ready();
    const message = await this.interaction.reply(payload);
    this.paginate(message);
    return message;
  }
  /**
   * Sends the reply as a `followUp`.
   *
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.followUp();
   * ```
   */
  async followUp() {
    const payload = this.ready();
    if (!(this.interaction instanceof discord_js.BaseInteraction)) throw new TypeError("The interaction is not an instance of Interaction");
    const message = await this.interaction.followUp(payload);
    this.paginate(message);
    return message;
  }
  /**
   * Edits the original reply with the final message.
   *
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.editReply();
   * ```
   */
  async editReply() {
    const payload = this.ready();
    if (!(this.interaction instanceof discord_js.BaseInteraction)) throw new TypeError("The interaction is not an instance of Interaction");
    const message = await this.interaction.editReply(payload);
    this.paginate(message);
    return message;
  }
  /**
   * Updates the interaction's pagination.
   *
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.update();
   * ```
   */
  async update() {
    const payload = this.ready();
    if (!(this.interaction instanceof discord_js.MessageComponentInteraction))
      throw new TypeError("The interaction is not an instance of MessageComponentInteraction");
    const message = await this.interaction.update(payload);
    this.paginate(message);
    return message;
  }
  /**
   * Sends the final message in the interaction's channel.
   *
   * @returns
   * @example
   * ```javascript
   * const pagination = new Pagination(interaction);
   * ...
   * pagination.send();
   * ```
   */
  async send() {
    const payload = this.ready();
    if (!this.interaction.channel) throw new Error("The interaction or message don't have a channel");
    if (this.interaction.channel.partial) await this.interaction.channel.fetch();
    if (this.interaction.channel.partial) throw new Error("The interaction or message has a partial channel");
    const message = await this.interaction.channel.send(payload);
    this.paginate(message);
    return message;
  }
};
__name(_Pagination, "Pagination");
var Pagination = _Pagination;

exports.ExtraRowPosition = ExtraRowPosition;
exports.Pagination = Pagination;
exports.PaginationEmbed = PaginationEmbed;
exports.authorOrUser = authorOrUser;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map